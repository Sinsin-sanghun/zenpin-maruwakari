// ============================================
// STREAMING PATCH for zenpin-maruwakari
// ============================================
// REPLACE the existing fetch+json block in the AI chat function
//
// OLD CODE (to find and replace):
//   const r=await fetch(API_CHAT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:HIST.slice(-6),showPrice:SHOW_PRICE})});
//   const d=await r.json();
//   if(d.error){ ... }else{ const rawTxt=d.response||'応答なし'; ... }
//
// NEW CODE (streaming version):

    const r=await fetch(API_CHAT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:HIST.slice(-6),showPrice:SHOW_PRICE})});

    // Check if response is streaming (text/event-stream) or legacy JSON
    const ct=r.headers.get('content-type')||'';
    if(ct.includes('text/event-stream')){
      // === STREAMING MODE ===
      const reader=r.body.getReader();
      const dec=new TextDecoder();
      let rawTxt='';
      let buf='';
      const ab=document.getElementById('ab');
      ab.innerHTML='';
      showAI();

      while(true){
        const{done,value}=await reader.read();
        if(done)break;
        buf+=dec.decode(value,{stream:true});
        const lines=buf.split('\n');
        buf=lines.pop()||'';
        for(const line of lines){
          if(!line.startsWith('data: '))continue;
          const payload=line.slice(6);
          if(payload==='[DONE]')continue;
          try{
            const ev=JSON.parse(payload);
            if(ev.type==='content_block_delta'&&ev.delta&&ev.delta.type==='text_delta'){
              rawTxt+=ev.delta.text;
              const cleanTxt=cleanRecTags?cleanRecTags(rawTxt):rawTxt.replace(/<<RECOMMEND:[^>]+>>/g,'');
              ab.innerHTML=renderMarkdown(cleanTxt);
              ab.scrollTop=ab.scrollHeight;
            }
          }catch(e){}
        }
      }

      if(!rawTxt)rawTxt='応答なし';
      HIST.push({role:'user',content:rawMsg||msg},{role:'assistant',content:rawTxt});
      const recs=typeof parseRecommendations==='function'?parseRecommendations(rawTxt):{ids:[],names:[]};
      REC_IDS=recs.ids;REC_NAMES=recs.names;
      const finalClean=cleanRecTags?cleanRecTags(rawTxt):rawTxt.replace(/<<RECOMMEND:[^>]+>>/g,'');
      ab.innerHTML=renderMarkdown(finalClean);
      LAST_AI_HTML=ab.innerHTML;
      showAI();
      if(typeof renderRecButtons==='function')renderRecButtons();

    }else{
      // === LEGACY JSON MODE (fallback) ===
      const d=await r.json();
      if(d.error){
        document.getElementById('ab').innerHTML='<span style="color:#f97316">⚠️ '+esc(d.error)+'</span>';
        LAST_AI_HTML=document.getElementById('ab').innerHTML;
        showAI();
      }else{
        const rawTxt=d.response||'応答なし';
        HIST.push({role:'user',content:rawMsg||msg},{role:'assistant',content:rawTxt});
        const recs=typeof parseRecommendations==='function'?parseRecommendations(rawTxt):{ids:[],names:[]};
        REC_IDS=recs.ids;REC_NAMES=recs.names;
        const txt=cleanRecTags?cleanRecTags(rawTxt):rawTxt.replace(/<<RECOMMEND:[^>]+>>/g,'');
        const html=renderMarkdown(txt);
        document.getElementById('ab').innerHTML=html;
        LAST_AI_HTML=document.getElementById('ab').innerHTML;
        showAI();
        if(typeof renderRecButtons==='function')renderRecButtons();
      }
    }
