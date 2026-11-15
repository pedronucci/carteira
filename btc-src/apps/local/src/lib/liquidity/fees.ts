/** Uniswap V3 fee growth inside, arithmetic modulo uint256, integer token units. */
export function accruedFee(liquidity:bigint,global:bigint,lowerOutside:bigint,upperOutside:bigint,lastInside:bigint,tick:number,lower:number,upper:number){
 const mod=(v:bigint)=>BigInt.asUintN(256,v);
 if(liquidity<0n||lower>=upper)throw Error("Posição inválida");
 const below=tick>=lower?lowerOutside:mod(global-lowerOutside);
 const above=tick<upper?upperOutside:mod(global-upperOutside);
 return liquidity*mod(mod(global-below-above)-lastInside)/(1n<<128n);
}
