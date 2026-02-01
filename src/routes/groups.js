const express = require('express');
const router = express.Router();
const auth = require('../utils/authMiddleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.post('/', auth, async (req,res)=>{
  const {name,currency} = req.body;
  const group = await prisma.group.create({data:{name,currency:currency||'INR'}});
  await prisma.groupMember.create({data:{groupId:group.id,userId:req.user.id,isAdmin:true}});
  res.status(201).json(group);
});

router.get('/', auth, async (req,res)=>{
  const members = await prisma.groupMember.findMany({where:{userId:req.user.id}, include:{group:true}});
  const groups = members.map(m=>m.group);
  res.json(groups);
});

router.get('/:groupId', auth, async (req,res)=>{
  const {groupId} = req.params;
  const group = await prisma.group.findUnique({where:{id:groupId}, include:{members:{include:{user:true}}, expenses:{include:{payer:true,splits:true}}}});
  if(!group) return res.status(404).json({error:'Not found'});
  res.json(group);
});

// members endpoint
router.get('/:groupId/members', auth, async (req,res)=>{
  const members = await prisma.groupMember.findMany({where:{groupId:req.params.groupId}, include:{user:true}});
  res.json(members.map(m=>m.user));
});

module.exports = router;
