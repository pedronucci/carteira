/** Arte vetorial leve, incorporada ao bundle, sem solicitações externas. */
export function NexusHorizon() {
 return <svg className="nexus-horizon" viewBox="0 0 1400 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
 <defs><radialGradient id="planet"><stop stopColor="#201a0d"/><stop offset=".8" stopColor="#39270d"/><stop offset=".97" stopColor="#f4b942"/><stop offset="1" stopColor="#fff5b0"/></radialGradient><linearGradient id="horizon"><stop stopColor="#f4b942"/><stop offset=".5" stopColor="#00e5df"/><stop offset="1" stopColor="#005777"/></linearGradient><radialGradient id="halo"><stop stopColor="#f4b942" stopOpacity=".36"/><stop offset="1" stopColor="#f4b942" stopOpacity="0"/></radialGradient></defs>
 <ellipse cx="900" cy="100" rx="300" ry="175" fill="url(#halo)"/>
 <g fill="#78d6e1" opacity=".45">{Array.from({length:48},(_,i)=><circle key={i} cx={(i*137)%1400} cy={(i*47)%170} r={i%4===0?1.3:.65}/>)}</g>
 <g fill="none" stroke="url(#horizon)" opacity=".38"><ellipse cx="930" cy="160" rx="380" ry="110" transform="rotate(-15 930 160)"/><ellipse cx="930" cy="160" rx="400" ry="120" transform="rotate(-15 930 160)"/></g>
 <circle cx="935" cy="136" r="106" fill="url(#planet)"/><g stroke="#c28a29" fill="none" opacity=".45"><ellipse cx="935" cy="136" rx="52" ry="105"/><ellipse cx="935" cy="136" rx="84" ry="105"/><ellipse cx="935" cy="136" rx="104" ry="35"/></g>
 <text x="935" y="166" textAnchor="middle" fill="#ffd46a" fontSize="105" fontFamily="sans-serif" transform="rotate(12 935 136)">₿</text>
 <path d="M0 225 Q700 98 1400 196 L1400 250H0Z" fill="#050a10" stroke="url(#horizon)" strokeWidth="2"/>
 <path d="M400 226L540 199 585 212 663 164 700 185 760 174 815 200 880 187 948 217 1040 192 1120 222 1240 198 1400 223V250H400Z" fill="#07151c" stroke="#14717b" strokeWidth=".7"/>
 </svg>;
}
export function NexusTerrain() {return <svg className="nexus-terrain" viewBox="0 0 250 230" aria-hidden><defs><linearGradient id="terrain"><stop stopColor="#00e5df" stopOpacity="0"/><stop offset="1" stopColor="#00e5df" stopOpacity=".18"/></linearGradient></defs><path d="M0 170L42 140 65 155 125 60 170 130 195 115 250 163V230H0Z" fill="url(#terrain)" stroke="#00a6b0"/>{Array.from({length:9},(_,i)=><path key={i} d={`M0 ${175+i*7}L125 ${60+i*18} 250 ${165+i*7}M${i*29} 230L125 60`} fill="none" stroke={i%3===0?'#8658e8':'#136676'} strokeWidth=".65"/>)}</svg>}
