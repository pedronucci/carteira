import horizon from "../assets/nexus-horizon-v2.webp";
export function NexusHorizon() { return <img className="nexus-horizon" src={horizon} alt="" aria-hidden />; }
export function NexusTerrain() { return <div className="nexus-terrain" style={{backgroundImage:`url(${horizon})`}} aria-hidden />; }
