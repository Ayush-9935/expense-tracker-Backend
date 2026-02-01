function simplifyBalances(balances){
  const creditors = balances.filter(b=>b.net>0).map(b=>({...b})).sort((a,b)=>b.net-a.net);
  const debtors = balances.filter(b=>b.net<0).map(b=>({...b})).sort((a,b)=>a.net-b.net);
  const settlements = [];
  let i=0,j=0;
  while(i<debtors.length && j<creditors.length){
    const owe = -debtors[i].net;
    const receive = creditors[j].net;
    const transfer = Math.min(owe, receive);
    settlements.push({from:debtors[i].userId, to:creditors[j].userId, amount: +transfer.toFixed(2)});
    debtors[i].net += transfer;
    creditors[j].net -= transfer;
    if(Math.abs(debtors[i].net) < 0.01) i++;
    if(Math.abs(creditors[j].net) < 0.01) j++;
  }
  return settlements;
}
module.exports = { simplifyBalances };
