/** Recibo de execução + custos L1 quando aplicáveis. Nunca omite uma parcela conhecida. */
export function gasWei(chain:number,receipt:Record<string,any>,tx:Record<string,any>,at?:number):bigint|null{
 if(receipt.gasUsed==null||(receipt.effectiveGasPrice??tx.gasPrice)==null)return null;
 let total=BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice??tx.gasPrice);
 if(chain===10||chain===8453){
  if(receipt.l1Fee==null)return null;total+=BigInt(receipt.l1Fee);
  if(receipt.operatorFee!=null)total+=BigInt(receipt.operatorFee);
  else if(receipt.operatorFeeScalar!=null){
   // A fórmula mudou em Jovian. Sem identificar o fork, só scalar=0 é inequívoco.
   if(BigInt(receipt.operatorFeeScalar)!==0n||receipt.operatorFeeConstant==null)return null;
   total+=BigInt(receipt.operatorFeeConstant);
  }
  else if(at==null||at>=Date.UTC(2025,4,9))return null;
  if(receipt.opGasRefund!=null)total-=BigInt(receipt.opGasRefund);
 }
 return total>=0n?total:null;
}
export function nativePriceId(chain:number,at=Date.now()){
 return chain===56?"coingecko:binancecoin":chain===101?"coingecko:solana":chain===137?(at<Date.UTC(2024,8,4)?"coingecko:matic-network":"coingecko:polygon-ecosystem-token"):"coingecko:ethereum";
}
