'use strict';
// Local answers never require a wallet request. ACK statistics only after durable storage.
function createEmbeddedHumanCheckBridge({evalProfilePort,recordCaptchaSolved,getConfig}) {
  const busy=new Set();
  async function collect(profile,state) {
    if(!profile?.debugPort||busy.has(profile.id))return false;
    busy.add(profile.id);
    try {
      const preferences=getConfig?.()||{};
      const config={autoAnswer:preferences.autoAnswer!==false,answerDelayMs:Math.max(800,Math.min(10000,Number(preferences.answerDelayMs)||1800))};
      const response=await evalProfilePort(profile.debugPort,`(() => {
        if(!window.__pmEmbeddedHumanCheckSolver)return {enabled:false,events:[]};
        window.__pmHumanCheckSolverConfig=${JSON.stringify(config)};
        try{localStorage.setItem('pelican_embedded_human_check_cfg',JSON.stringify(window.__pmHumanCheckSolverConfig));}catch(_){}
        let events=[];try{events=typeof window.__pmGetHumanCheckEvents==='function'?window.__pmGetHumanCheckEvents():(window.__pmLocalHumanCheckEvents||[]);}catch(_){}
        return {enabled:true,events:Array.isArray(events)?events.slice(0,100):[]};
      })()`,3000);
      if(!response?.success||response.result?.enabled!==true)return false;
      if(state?.humanCheck)state.humanCheck.embeddedSolver=true;
      const acknowledged=[];
      for(const event of response.result.events||[]) {
        if(!event||typeof event.eventId!=='string'||!event.eventId||event.eventId.length>128||!Number.isSafeInteger(event.timestamp)||event.timestamp<1)continue;
        if(recordCaptchaSolved(profile.id,event))acknowledged.push(event.eventId);
      }
      if(acknowledged.length)await evalProfilePort(profile.debugPort,`(() => {const ids=${JSON.stringify(acknowledged)};return typeof window.__pmAckHumanCheckEvents==='function'?window.__pmAckHumanCheckEvents(ids):window.__pmAckLocalHumanCheckEvents?.(ids);})()`,3000);
      return true;
    }catch(_){return false;}finally{busy.delete(profile.id);}
  }
  return {collect};
}
module.exports={createEmbeddedHumanCheckBridge};
