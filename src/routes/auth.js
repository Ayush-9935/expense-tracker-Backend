const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

router.post('/register', async (req,res)=>{
  const {name,email,password} = req.body;
  if(!email||!password) return res.status(400).json({error:'Missing'});
  const existing = await prisma.user.findUnique({where:{email}});
  if(existing) return res.status(400).json({error:'Email exists'});
  const hash = await bcrypt.hash(password,10);
  const user = await prisma.user.create({data:{name,email,password:hash}});
  const token = jwt.sign({id:user.id}, process.env.JWT_SECRET);
  res.json({user:{id:user.id,name:user.name,email:user.email},token});
});

router.post('/login', async (req,res)=>{
  const {email,password} = req.body;
  const user = await prisma.user.findUnique({where:{email}});
  if(!user) return res.status(400).json({error:'Invalid'});
  const ok = await bcrypt.compare(password,user.password);
  if(!ok) return res.status(400).json({error:'Invalid'});
  const token = jwt.sign({id:user.id}, process.env.JWT_SECRET);
  res.json({user:{id:user.id,name:user.name,email:user.email},token});
});

// optional me endpoint
router.get('/me', async (req,res)=>{
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({error:'No token'});
  const token = auth.split(' ')[1];
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({where:{id:payload.id}, select:{id:true,name:true,email:true}});
    res.json(user);
  }catch(e){
    res.status(401).json({error:'Invalid'});
  }
});

module.exports = router;
