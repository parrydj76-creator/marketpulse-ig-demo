'use strict';

const {savePaperEvent}=require('./paper-store');

class PaperArchiver {
  constructor(){
    this.pending=new Map();
    this.saved=0;
    this.lastError=null;
    this.busy=false;
  }

  enqueue(events){
    for(const event of events){
      if(!event || !['OPEN','CLOSE'].includes(event.kind))continue;

      const key=JSON.stringify(event);
      if(!this.pending.has(key)){
        this.pending.set(key,event);
      }
    }
  }

  async flush(){
    if(this.busy || this.pending.size===0)return;

    this.busy=true;

    try{
      for(const [key,event] of this.pending){
        try{
          await savePaperEvent(event);
          this.pending.delete(key);
          this.saved++;
          this.lastError=null;
        }catch(e){
          this.lastError=e.message;
          break;
        }
      }
    }finally{
      this.busy=false;
    }
  }

  status(){
    return {
      pending:this.pending.size,
      saved:this.saved,
      lastError:this.lastError
    };
  }
}

module.exports={PaperArchiver};
