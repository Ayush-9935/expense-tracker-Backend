import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";

dotenv.config();
const app = express();

/* =======================
   ✅ MIDDLEWARE (PRODUCTION READY)
======================= */

// ✅ allow both localhost + deployed frontend
const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // ✅ allow postman / server-to-server calls (no origin)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.use(express.json());

/* =======================
   ✅ MONGODB CONNECT
======================= */
const mongoURI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart-expense";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* =======================
   ✅ MODELS
======================= */

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    password: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

/* ✅ NEW: Register schema (Register DB) */
const registerSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    password: String, // hashed
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const Register = mongoose.model("Register", registerSchema);

/* ✅ Expense schema */
const expenseSchema = new mongoose.Schema(
  {
    payer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: Number,
    description: String,
  },
  { timestamps: true }
);

/* ✅ NEW: Expense model (Expense DB) */
const Expense = mongoose.model("Expense", expenseSchema);

const settlementSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  from: String,
  to: String,
  amount: Number,
  paidAt: Date,
});

const groupSchema = new mongoose.Schema(
  {
    name: String,

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    expenses: [expenseSchema],

    settledPayments: [settlementSchema],
  },
  { timestamps: true }
);

const Group = mongoose.model("Group", groupSchema);

/* =======================
   ✅ AUTH ROUTES
======================= */

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Store in USERS DB
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    // ✅ ALSO Store in REGISTER DB
    const registerEntry = new Register({
      name,
      email,
      password: hashedPassword,
      userId: user._id,
    });
    await registerEntry.save();

    res.status(201).json({
      message: "User registered successfully",
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* =======================
   ✅ DASHBOARD ROUTE
======================= */
app.get("/api/dashboard", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const groups = await Group.find({
      $or: [{ createdBy: userId }, { members: userId }],
    })
      .populate("members", "name email")
      .populate("expenses.payer", "name email")
      .sort({ createdAt: -1 });

    let allExpenses = [];
    groups.forEach((g) => {
      (g.expenses || []).forEach((ex) => {
        allExpenses.push({
          ...ex.toObject(),
          groupId: g._id,
          groupName: g.name,
        });
      });
    });

    allExpenses.sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
    );

    const totalGroups = groups.length;

    const uniqueMembers = new Set();
    groups.forEach((g) => {
      (g.members || []).forEach((m) => uniqueMembers.add(String(m._id || m)));
    });

    const totalMembers = uniqueMembers.size;
    const totalExpenses = allExpenses.length;
    const totalSpent = allExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const now = new Date();
    const monthSpent = allExpenses
      .filter((e) => {
        const d = new Date(e.createdAt || 0);
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    let topGroup = { name: "-", value: 0 };
    groups.forEach((g) => {
      const total = (g.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
      if (total > topGroup.value) topGroup = { name: g.name, value: total };
    });

    const noExpenseGroups = groups.filter(
      (g) => (g.expenses || []).length === 0
    ).length;
    const activeGroups = groups.filter(
      (g) => (g.expenses || []).length > 0
    ).length;

    const notifications = [];
    if (activeGroups > 0)
      notifications.push({
        type: "good",
        text: `✅ ${activeGroups} group(s) have active expenses.`,
      });

    if (noExpenseGroups > 0)
      notifications.push({
        type: "warn",
        text: `⚠️ ${noExpenseGroups} group(s) have no expenses yet.`,
      });

    if (groups.length === 0)
      notifications.push({
        type: "warn",
        text: `⚠️ Create your first group to start splitting.`,
      });

    return res.json({
      stats: {
        totalGroups,
        totalMembers,
        totalExpenses,
        totalSpent,
        monthSpent,
      },
      topGroup,
      recentExpenses: allExpenses.slice(0, 7),
      notifications,
    });
  } catch (err) {
    console.error("❌ Dashboard route error:", err);
    res.status(500).json({ error: "Dashboard fetch failed" });
  }
});

/* =======================
   ✅ GROUP ROUTES
======================= */

app.get("/api/groups", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.json([]);

    const groups = await Group.find({
      $or: [{ createdBy: userId }, { members: userId }],
    })
      .populate("members", "name email")
      .populate("expenses.payer", "name email")
      .sort({ createdAt: -1 });

    res.json(groups);
  } catch (err) {
    console.error("❌ Get groups error:", err);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

app.post("/api/groups", async (req, res) => {
  try {
    const { name, createdBy } = req.body;

    if (!name || !createdBy)
      return res
        .status(400)
        .json({ error: "Group name and createdBy required" });

    const newGroup = new Group({
      name: name.trim(),
      createdBy,
      members: [createdBy],
      expenses: [],
      settledPayments: [],
    });

    await newGroup.save();
    res.status(201).json(newGroup);
  } catch (err) {
    console.error("❌ Create group error:", err);
    res.status(500).json({ error: "Failed to create group" });
  }
});

app.put("/api/groups/:id", async (req, res) => {
  try {
    const { name, userId } = req.body;

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (group.createdBy.toString() !== userId)
      return res.status(403).json({ error: "Not allowed" });

    group.name = name.trim();
    await group.save();

    res.json({ message: "Group updated ✅", group });
  } catch (err) {
    console.error("❌ Update group error:", err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

app.delete("/api/groups/:id", async (req, res) => {
  try {
    const { userId } = req.query;

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (group.createdBy.toString() !== userId)
      return res.status(403).json({ error: "Not allowed" });

    await Group.findByIdAndDelete(req.params.id);
    res.json({ message: "Group deleted ✅" });
  } catch (err) {
    console.error("❌ Delete group error:", err);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

/* =======================
   ✅ MEMBER ROUTES
======================= */

app.post("/api/groups/:id/members", async (req, res) => {
  try {
    const { memberName } = req.body;

    if (!memberName || !memberName.trim())
      return res.status(400).json({ error: "memberName required" });

    const name = memberName.trim();

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    let userFound = await User.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
    });

    // auto create
    if (!userFound) {
      const safe = name.toLowerCase().replace(/\s+/g, ".");
      const uniqueEmail = `${safe}.${Date.now()}@auto.local`;
      const dummyPassword = await bcrypt.hash("123456", 10);

      userFound = new User({
        name,
        email: uniqueEmail,
        password: dummyPassword,
      });

      await userFound.save();
    }

    const already = group.members.some(
      (m) => m.toString() === userFound._id.toString()
    );
    if (already) return res.status(400).json({ error: "Member already exists" });

    group.members.push(userFound._id);
    await group.save();

    res.json({
      message: "Member added ✅",
      member: {
        id: userFound._id,
        name: userFound.name,
        email: userFound.email,
      },
    });
  } catch (err) {
    console.error("❌ Add member error:", err);
    res.status(500).json({ error: "Failed to add member" });
  }
});

app.delete("/api/groups/:id/members/by-name/:memberName", async (req, res) => {
  try {
    const { id, memberName } = req.params;

    if (!memberName || !memberName.trim())
      return res.status(400).json({ error: "memberName required" });

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (group.members.length <= 1)
      return res
        .status(400)
        .json({ error: "Group must have at least 1 member" });

    const userFound = await User.findOne({
      name: { $regex: `^${memberName.trim()}$`, $options: "i" },
    });

    if (!userFound) return res.status(404).json({ error: "User not found" });

    const exists = group.members.some(
      (m) => m.toString() === userFound._id.toString()
    );
    if (!exists)
      return res.status(400).json({ error: "Member not in this group" });

    group.members = group.members.filter(
      (m) => m.toString() !== userFound._id.toString()
    );
    await group.save();

    res.json({ message: "Member removed ✅" });
  } catch (err) {
    console.error("❌ Remove member by name error:", err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

/* =======================
   ✅ EXPENSE ROUTES
======================= */

app.post("/api/groups/:id/expenses", async (req, res) => {
  try {
    const { payerId, amount, description } = req.body;

    if (!payerId || !amount)
      return res.status(400).json({ error: "payerId and amount required" });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    // ✅ Save in group (OLD)
    const expenseObj = {
      payer: payerId,
      amount: Number(amount),
      description: description || "Expense",
    };

    group.expenses.push(expenseObj);
    await group.save();

    // ✅ ALSO save in Expenses DB (NEW)
    await Expense.create(expenseObj);

    res.status(201).json({ message: "Expense added ✅" });
  } catch (err) {
    console.error("❌ Add expense error:", err);
    res.status(500).json({ error: "Failed to add expense" });
  }
});

/* ✅ UPDATE EXPENSE */
app.put("/api/groups/:id/expenses/:expenseId", async (req, res) => {
  try {
    const { id, expenseId } = req.params;
    const { payerId, amount, description } = req.body;

    if (!payerId || !amount)
      return res.status(400).json({ error: "payerId and amount required" });

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const expense = group.expenses.id(expenseId);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    expense.payer = payerId;
    expense.amount = Number(amount);
    expense.description = description || "Expense";

    await group.save();

    // ✅ Update also in Expenses DB (best match by fields)
    await Expense.updateMany(
      { payer: payerId, description: expense.description },
      { $set: { payer: payerId, amount: Number(amount), description: description || "Expense" } }
    );

    res.json({ message: "Expense updated ✅" });
  } catch (err) {
    console.error("❌ Update expense error:", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

app.delete("/api/groups/:id/expenses/:expenseId", async (req, res) => {
  try {
    const { id, expenseId } = req.params;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    // store copy for deleting in Expense DB
    const exp = group.expenses.id(expenseId);

    group.expenses = group.expenses.filter(
      (e) => e._id.toString() !== expenseId
    );
    await group.save();

    // ✅ Delete from Expense DB also
    if (exp) {
      await Expense.deleteMany({
        payer: exp.payer,
        amount: exp.amount,
        description: exp.description,
      });
    }

    res.json({ message: "Expense deleted ✅" });
  } catch (err) {
    console.error("❌ Delete expense error:", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

/* =======================
   ✅ SETTLEMENT ROUTE (FIXED)
======================= */
app.post("/api/groups/:id/settle", async (req, res) => {
  try {
    const { from, to, amount } = req.body;

    if (!from || !to || !amount)
      return res.status(400).json({ error: "Missing settlement data" });

    const group = await Group.findById(req.params.id).populate(
      "members",
      "name email"
    );

    if (!group) return res.status(404).json({ error: "Group not found" });

    const fromUser = group.members.find(
      (m) => m.name.toLowerCase() === String(from).toLowerCase()
    );
    const toUser = group.members.find(
      (m) => m.name.toLowerCase() === String(to).toLowerCase()
    );

    if (!fromUser || !toUser) {
      return res
        .status(400)
        .json({ error: "Settlement members not found in group" });
    }

    group.settledPayments.push({
      fromUserId: fromUser._id,
      toUserId: toUser._id,
      from: fromUser.name,
      to: toUser.name,
      amount: Number(amount),
      paidAt: new Date(),
    });

    await group.save();
    res.json({ message: "Settlement recorded ✅" });
  } catch (err) {
    console.error("❌ Settle error:", err);
    res.status(500).json({ error: "Failed to settle payment" });
  }
});

/* =======================
   ✅ GET SINGLE GROUP
======================= */
app.get("/api/groups/:id", async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate("members", "name email")
      .populate("expenses.payer", "name email");

    if (!group) return res.status(404).json({ error: "Group not found" });

    const total = group.expenses.reduce((sum, ex) => sum + (ex.amount || 0), 0);
    const perHead = group.members.length ? total / group.members.length : 0;

    const paidMap = {};
    group.members.forEach((m) => (paidMap[m._id.toString()] = 0));

    group.expenses.forEach((ex) => {
      const pid = ex.payer?._id?.toString();
      if (pid) paidMap[pid] = (paidMap[pid] || 0) + (ex.amount || 0);
    });

    let balances = group.members.map((m) => {
      const paid = paidMap[m._id.toString()] || 0;
      return {
        userId: m._id,
        name: m.name,
        balance: paid - perHead,
      };
    });

    const settleList = group.settledPayments || [];

    const findUserId = (name, fallbackId) => {
      if (fallbackId) return String(fallbackId);
      const found = group.members.find(
        (m) => m.name.toLowerCase() === String(name || "").toLowerCase()
      );
      return found ? String(found._id) : null;
    };

    settleList.forEach((s) => {
      const fromId = findUserId(s.from, s.fromUserId);
      const toId = findUserId(s.to, s.toUserId);
      const amt = Number(s.amount || 0);

      if (!fromId || !toId || !amt) return;

      balances = balances.map((b) => {
        if (String(b.userId) === fromId)
          return { ...b, balance: b.balance + amt };
        if (String(b.userId) === toId)
          return { ...b, balance: b.balance - amt };
        return b;
      });
    });

    balances = balances.map((b) => ({
      ...b,
      balance: +b.balance.toFixed(2),
    }));

    const debtors = balances
      .filter((b) => b.balance < 0)
      .map((b) => ({ ...b, balance: Math.abs(b.balance) }));

    const creditors = balances.filter((b) => b.balance > 0);

    const settlements = [];
    let i = 0,
      j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];

      const pay = Math.min(debtor.balance, creditor.balance);

      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount: +pay.toFixed(2),
      });

      debtor.balance -= pay;
      creditor.balance -= pay;

      if (debtor.balance <= 0.01) i++;
      if (creditor.balance <= 0.01) j++;
    }

    res.json({
      ...group.toObject(),
      balances,
      settlements,
    });
  } catch (err) {
    console.error("❌ Get group error:", err);
    res.status(500).json({ error: "Failed to fetch group" });
  }
});

/* =======================
   ✅ DEFAULT ROUTE
======================= */
app.get("/", (req, res) => {
  res.send("✅ Smart Expense Splitter Backend running");
});

/* =======================
   ✅ START SERVER
======================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
