const express = require('express');
const router = express.Router({mergeParams:true});
const auth = require('../utils/authMiddleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { simplifyBalances } = require('../utils/simplify');

router.post('/:groupId/expenses', auth, async (req,res)=>{
  const {groupId} = req.params;
  const {amount, description, splits} = req.body;
  if(!amount||!splits||!Array.isArray(splits)) return res.status(400).json({error:'Missing'});
  const expense = await prisma.expense.create({data:{groupId, payerId:req.user.id, amount:parseFloat(amount), description}});
  const share = +((amount / splits.length).toFixed(2));
  const splitCreates = splits.map(u=>({expenseId:expense.id, userId:u, share}));
  await prisma.expenseSplit.createMany({data:splitCreates});
  const members = await prisma.groupMember.findMany({where:{groupId}, include:{user:true}});
  const users = members.map(m=>m.user);
  const balances = [];
  for(const u of users){
    const paidAgg = await prisma.expense.aggregate({where:{groupId, payerId:u.id}, _sum:{amount:true}});
    const shareAgg = await prisma.expenseSplit.aggregate({where:{userId:u.id, expense:{groupId}}, _sum:{share:true}}).catch(()=>({_sum:{share:0}}));
    const paid = paidAgg._sum.amount || 0;
    const shareTotal = (shareAgg._sum.share) || 0;
    balances.push({userId:u.id, net: +(paid - shareTotal)});
  }
  const settlements = simplifyBalances(balances);
  res.status(201).json({expense,balances,settlements});
});

router.get('/:groupId/expenses', auth, async (req,res)=>{
  const {groupId} = req.params;
  const list = await prisma.expense.findMany({where:{groupId}, include:{splits:true,payer:true}});
  res.json(list);
});

router.get('/:groupId/balances', auth, async (req,res)=>{
  const {groupId} = req.params;
  const members = await prisma.groupMember.findMany({where:{groupId}, include:{user:true}});
  const users = members.map(m=>m.user);
  const balances = [];
  for(const u of users){
    const paidAgg = await prisma.expense.aggregate({where:{groupId, payerId:u.id}, _sum:{amount:true}});
    const shareAgg = await prisma.expenseSplit.aggregate({where:{userId:u.id, expense:{groupId}}, _sum:{share:true}}).catch(()=>({_sum:{share:0}}));
    const paid = paidAgg._sum.amount || 0;
    const shareTotal = (shareAgg._sum.share) || 0;
    balances.push({userId:u.id, net: +(paid - shareTotal)});
  }
  const settlements = simplifyBalances(balances);
  res.json({balances,settlements});
});

module.exports = router;
