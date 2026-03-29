import React from 'react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">
      {/* Dynamic Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-gray-950/80 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-gradient-to-tr from-cyan-500 to-blue-600 animate-pulse" />
            <h1 className="text-xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
              VIGILANCE
            </h1>
          </div>
          <div className="flex space-x-6">
            <span className="text-sm font-medium text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer">Live Feed</span>
            <span className="text-sm font-medium text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer">Findings</span>
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span className="text-sm text-green-500 font-mono">Nosana GPU Active</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Sub-Header / Demo Config */}
        <section className="p-6 rounded-2xl bg-gray-900 border border-gray-800 shadow-xl backdrop-blur-sm relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-500">
           <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
           <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                 <h2 className="text-lg font-semibold text-white">Target Assignment Command</h2>
                 <p className="text-sm text-gray-400 mt-1">Provide a repository or Immunefi project URL for the Scout agent.</p>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                 <input 
                   type="text" 
                   className="w-full md:w-80 px-4 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all" 
                   placeholder="e.g. github.com/traderjoe-xyz/contracts..."
                 />
                 <button className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm transition-colors shadow-[0_0_15px_rgba(8,145,178,0.4)]">
                    Deploy Scout
                 </button>
              </div>
           </div>
        </section>

        {/* Scout Feed & Filters */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           
           {/* Filters Sidebar */}
           <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
                 <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Target Filters</h3>
                 <div className="space-y-3">
                    {['Smart Contracts', 'Blockchain / DLT', 'Websites & Apps'].map((cat, i) => (
                      <label key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-800 cursor-pointer transition-colors border border-transparent hover:border-gray-700">
                         <input type="checkbox" defaultChecked={i < 2} className="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-cyan-500 bg-gray-950" />
                         <span className="text-sm text-gray-300">{cat}</span>
                      </label>
                    ))}
                 </div>
              </div>
           </div>

           {/* Live Feed */}
           <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between mb-2">
                 <h2 className="text-xl font-bold flex items-center gap-2">
                    <svg className="w-5 h-5 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Scout Feed
                 </h2>
              </div>
              
              {/* Dummy Item 1 */}
              <div className="p-5 rounded-2xl bg-gray-900/50 border border-gray-800 hover:bg-gray-900 transition-colors group">
                 <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                       <span className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 text-xs font-mono border border-blue-500/20">Smart Contract</span>
                       <h4 className="font-semibold text-gray-200">Radiant Capital Bounty</h4>
                    </div>
                    <span className="text-xs font-mono text-gray-500">2 min ago</span>
                 </div>
                 <p className="text-sm text-gray-400 leading-relaxed mb-4">
                    Extracted rules from Immunefi. In-scope impacts include Logic Errors and Reentrancy. Up to $200k reward.
                 </p>
                 <div className="flex items-center justify-between">
                    <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded flex items-center gap-1">
                       <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" /> Awaiting Human Approval
                    </span>
                 </div>
              </div>
           </div>
        </section>

        {/* Findings Gallery */}
        <section className="pt-8">
           <h2 className="text-xl font-bold mb-6 border-b border-gray-800 pb-4">Verified Findings</h2>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Dummy Finding */}
              <div className="p-6 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 relative group overflow-hidden">
                 <div className="absolute top-0 right-0 p-4 opacity-10">
                    <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                 </div>
                 <div className="relative z-10">
                    <div className="flex justify-between items-center mb-4">
                       <span className="text-xs font-bold text-red-500 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">Critical severity</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Unchecked Initializer in Proxy</h3>
                    <p className="text-sm text-gray-400 mb-6 line-clamp-2">
                       The Reviewer confirmed that the Auditor's PoC successfully exploits an unprotected initializer on the implementation contract.
                    </p>
                    <div className="flex gap-3">
                       <button className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors border border-gray-700">View Report</button>
                       <button className="flex-1 py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 text-sm font-medium transition-colors border border-cyan-500/30 flex items-center justify-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          Download PoC
                       </button>
                    </div>
                 </div>
              </div>
           </div>
        </section>
      </main>
    </div>
  );
}
