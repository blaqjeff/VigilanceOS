import React from 'react';

export default function JarvisHUD() {
  return (
    <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden transition-opacity duration-1000 hud-container">
      {/* Deep volumetric space background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#001a33_0%,_#000000_100%)] opacity-90" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,243,255,0.15)_0%,_transparent_50%)]" />

      {/* Main central rotating assembly - Scaled up with heavy glow */}
      <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[1600px] h-[1600px] mix-blend-screen scale-[0.6] md:scale-[0.9] drop-shadow-[0_0_20px_rgba(0,255,255,0.2)]">
        
        {/* Core Glow */}
        <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-cyan-500/20 rounded-full blur-[80px]" />

        {/* Outer Ring 1 - Dashed very slow */}
        <svg className="absolute inset-0 w-full h-full animate-[spin_180s_linear_infinite] opacity-30" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.05" className="text-cyan-400" strokeDasharray="0.5 1.5" />
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-cyan-600" strokeDasharray="5 5 1 5" />
        </svg>

        {/* Outer Ring 2 - Massive data arcs */}
        <svg className="absolute inset-0 w-full h-full animate-[spin_100s_linear_infinite_reverse] opacity-50" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-500" strokeDasharray="10 90" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400" strokeDasharray="5 95" transform="rotate(180 50 50)" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="0.1" className="text-emerald-500" />
        </svg>

        {/* Middle Complex Radar */}
        <svg className="absolute inset-0 w-full h-full animate-[spin_60s_linear_infinite]" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-800" strokeDasharray="0.2 2" />
          <circle cx="50" cy="50" r="34.5" fill="none" stroke="currentColor" strokeWidth="0.1" className="text-cyan-300" />
          <path d="M 50 15 L 50 20 M 50 80 L 50 85 M 15 50 L 20 50 M 80 50 L 85 50" stroke="currentColor" strokeWidth="0.3" className="text-cyan-200" />
        </svg>

        {/* Inner Solid Tech Ring */}
        <svg className="absolute inset-0 w-full h-full animate-[spin_30s_linear_infinite_reverse]" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-cyan-400" strokeDasharray="15 5 5 75" />
          <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-700" strokeDasharray="40 60" />
          <circle cx="50" cy="50" r="25" fill="none" stroke="currentColor" strokeWidth="0.1" className="text-emerald-300" strokeDasharray="1 3" />
        </svg>
        
        {/* Core Static Reticle */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.85]" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="15" fill="none" stroke="currentColor" strokeWidth="0.15" className="text-cyan-200" strokeDasharray="1 2" />
          <circle cx="50" cy="50" r="8" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-cyan-400" />
          <circle cx="50" cy="50" r="2" fill="currentColor" className="text-cyan-200" />
          <line x1="50" y1="18" x2="50" y2="35" stroke="currentColor" strokeWidth="0.1" className="text-cyan-300" opacity="0.6" />
          <line x1="50" y1="65" x2="50" y2="82" stroke="currentColor" strokeWidth="0.1" className="text-cyan-300" opacity="0.6" />
          <line x1="18" y1="50" x2="35" y2="50" stroke="currentColor" strokeWidth="0.1" className="text-cyan-300" opacity="0.6" />
          <line x1="65" y1="50" x2="82" y2="50" stroke="currentColor" strokeWidth="0.1" className="text-cyan-300" opacity="0.6" />
          
          <path d="M 40 40 L 45 40 M 40 40 L 40 45" stroke="currentColor" strokeWidth="0.3" className="text-cyan-400" fill="none" />
          <path d="M 60 40 L 55 40 M 60 40 L 60 45" stroke="currentColor" strokeWidth="0.3" className="text-cyan-400" fill="none" />
          <path d="M 40 60 L 45 60 M 40 60 L 40 55" stroke="currentColor" strokeWidth="0.3" className="text-cyan-400" fill="none" />
          <path d="M 60 60 L 55 60 M 60 60 L 60 55" stroke="currentColor" strokeWidth="0.3" className="text-cyan-400" fill="none" />
        </svg>
      </div>

      {/* Decorative Text */}
      <div className="absolute top-[20%] left-8 text-[10px] font-mono text-cyan-400/60 uppercase tracking-widest leading-loose drop-shadow-[0_0_5px_rgba(0,255,255,0.4)] md:left-[10%]">
        <p>SYS.CORE.OP // <strong className="text-cyan-300">NOMINAL</strong></p>
        <p>MEM.ALLOC // <strong className="text-cyan-300">78.4%</strong></p>
        <p>EXT.NET // <strong className="text-cyan-300">SECURE</strong></p>
        <p className="mt-6 animate-[pulse_2s_ease-in-out_infinite]">AWAITING.FEED...</p>
      </div>
      
      {/* Hex Grid Background */}
      <div 
        className="absolute inset-0 opacity-[0.06] mix-blend-screen" 
        style={{ 
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='103.92' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath stroke='%2300ffff' stroke-width='0.5' fill='none' d='M30 0L60 17.32v34.64L30 69.28 0 51.96V17.32zM30 103.92L60 86.6V51.96L30 34.64 0 51.96v34.64z'/%3E%3C/svg%3E\")",
          backgroundSize: "60px auto",
          backgroundPosition: "center center"
        }}
      />
    </div>
  );
}
