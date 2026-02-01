const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({error:'No token'});
  const token = auth.split(' ')[1];
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({where:{id:payload.id}});
    if(!user) return res.status(401).json({error:'User not found'});
    req.user = user;
    next();
  }catch(e){
    return res.status(401).json({error:'Invalid token'});
  }
}
