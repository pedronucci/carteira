import {it,expect} from "vitest";
import {accruedFee} from "./fees";
const q=1n<<128n;
it("inside range subtracts lower and upper growth",()=>expect(accruedFee(10n,10n*q,q,2n*q,3n*q,0,-100,100)).toBe(40n));
it("below range growth excludes inactive side",()=>expect(accruedFee(10n,10n*q,8n*q,q,6n*q,-200,-100,100)).toBe(10n));
it("above range growth excludes inactive side",()=>expect(accruedFee(10n,10n*q,q,8n*q,6n*q,200,-100,100)).toBe(10n));
it("uint256 rollover does not become negative",()=>expect(accruedFee(1n,2n*q,0n,0n,(1n<<256n)-q,0,-100,100)).toBe(3n));
it("closed liquidity has no new fees",()=>expect(accruedFee(0n,10n*q,0n,0n,0n,0,-100,100)).toBe(0n));
