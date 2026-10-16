import { strokeId } from "../utils/random.js";

const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const distanceToSegment = (p,a,b) => { const dx=b[0]-a[0],dy=b[1]-a[1]; if(!dx&&!dy)return Math.hypot(p[0]-a[0],p[1]-a[1]); const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy),0,1); return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy)); };
export const strokePathPoints=(points,smooth)=>smooth&&points.length>2?points.map((point,index)=>{if(index===0||index===points.length-1)return point;const before=points[index-1],after=points[index+1];return[(before[0]+point[0]*2+after[0])/4,(before[1]+point[1]*2+after[1])/4,point[2],point[3]];}):points;
export const traceStrokeSegment=(ctx,path,index,width,height,smooth)=>{const point=path[index],previous=path[index-1];if(smooth&&path.length>2){const before=path[Math.max(0,index-2)],after=path[Math.min(path.length-1,index+1)],cp1x=previous[0]+(point[0]-before[0])/6,cp1y=previous[1]+(point[1]-before[1])/6,cp2x=point[0]-(after[0]-previous[0])/6,cp2y=point[1]-(after[1]-previous[1])/6;ctx.bezierCurveTo(cp1x*width,cp1y*height,cp2x*width,cp2y*height,point[0]*width,point[1]*height);}else ctx.lineTo(point[0]*width,point[1]*height);};
export function drawStrokeOnCanvas(ctx,stroke,width,height){const pts=stroke.points||[];if(!pts.length)return;const path=strokePathPoints(pts,stroke.smooth);ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color;ctx.globalAlpha=stroke.opacity??1;ctx.lineCap="round";ctx.lineJoin="round";if(path.length===1){ctx.beginPath();ctx.arc(path[0][0]*width,path[0][1]*height,stroke.width/2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;return;}for(let i=1;i<path.length;i++){const p=path[i],pressure=p[2]>0?p[2]:.5;ctx.lineWidth=stroke.width*(.6+pressure*.8);ctx.beginPath();ctx.moveTo(path[i-1][0]*width,path[i-1][1]*height);traceStrokeSegment(ctx,path,i,width,height,stroke.smooth);ctx.stroke();}ctx.globalAlpha=1;}

export class BoardEngine {
  constructor({ stage, backgroundCanvas, studentCanvas, teacherCanvas, editableLayer = null, uid = "", onComplete, onRemove, onActive, onViewChange }) {
    Object.assign(this,{stage,backgroundCanvas,studentCanvas,teacherCanvas,editableLayer,uid,onComplete,onRemove,onActive,onViewChange});
    this.strokes={studentStrokes:new Map(),teacherStrokes:new Map()}; this.tool="pen"; this.color=editableLayer==="teacherStrokes"?"#ef4444":"#173f5f"; this.width=5; this.smoothing=false;
    this.undoStack=[]; this.redoStack=[]; this.pointers=new Map(); this.scale=1; this.panX=0; this.panY=0; this.current=null; this.gesture=null; this.panDrag=null; this.drawingPointerId=null; this.activeEnabled=true; this.readOnly=false;
    this.handleDown=this.pointerDown.bind(this); this.handleMove=this.pointerMove.bind(this); this.handleUp=this.pointerUp.bind(this); this.handleCancel=this.pointerCancel.bind(this);
    this.preventBrowserGesture=event=>event.preventDefault();
    if(editableLayer){ const input=editableLayer==="studentStrokes"?studentCanvas:teacherCanvas; input.style.touchAction="none"; input.addEventListener("pointerdown",this.handleDown,{passive:false}); input.addEventListener("pointermove",this.handleMove,{passive:false}); input.addEventListener("pointerup",this.handleUp,{passive:false}); input.addEventListener("pointercancel",this.handleCancel,{passive:false}); input.addEventListener("lostpointercapture",this.handleCancel); stage.addEventListener("dblclick",this.preventBrowserGesture,{passive:false}); for(const name of ["gesturestart","gesturechange","gestureend"])stage.addEventListener(name,this.preventBrowserGesture,{passive:false}); }
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(stage); this.resize();
  }
  resize(){ const rect=this.stage.getBoundingClientRect(); if(!rect.width||!rect.height)return; if(this.cssWidth&&this.cssHeight&&(rect.width!==this.cssWidth||rect.height!==this.cssHeight)){this.finishInput();this.panX*=rect.width/this.cssWidth;this.panY*=rect.height/this.cssHeight;} this.cssWidth=rect.width;this.cssHeight=rect.height;this.constrainPan();const dpr=window.devicePixelRatio||1; for(const c of [this.backgroundCanvas,this.studentCanvas,this.teacherCanvas]){c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.height*dpr);c.style.width=`${rect.width}px`;c.style.height=`${rect.height}px`;} this.notifyViewChange();this.renderAll(); }
  setTool(tool){const next=["pen","eraser","pan"].includes(tool)?tool:"pen";if(next!==this.tool)this.finishInput();this.tool=next;this.renderInputState();}
  setColor(color){if(/^#[0-9A-Fa-f]{6}$/.test(color))this.color=color;} setWidth(width){this.width=clamp(Number(width),1,40);}
  setEnabled(value){if(!value)this.finishInput({commit:false});this.activeEnabled=Boolean(value);this.renderInputState();}
  setReadOnly(value){if(value&&!this.readOnly)this.finishInput({commit:false});this.readOnly=Boolean(value);}
  setSmoothing(value){this.smoothing=Boolean(value);if(this.current){this.current.smooth=this.smoothing;this.renderAll();}}
  coords(event){const r=this.stage.getBoundingClientRect(); return [clamp(((event.clientX-r.left-this.panX)/this.scale)/r.width,0,1),clamp(((event.clientY-r.top-this.panY)/this.scale)/r.height,0,1)];}
  point(event,start){const [x,y]=this.coords(event);return [+x.toFixed(4),+y.toFixed(4),+(event.pressure||.5).toFixed(2),Math.round(event.timeStamp-start)];}
  renderInputState(){if(this.stage.dataset)this.stage.dataset.tool=this.activeEnabled?this.tool:"";this.stage.classList?.toggle("panning",Boolean(this.panDrag||this.gesture));}
  constrainPan(){
    const {width,height}=this.stage.getBoundingClientRect();
    const visibleX=Math.min(width,width*this.scale)*.2,visibleY=Math.min(height,height*this.scale)*.2;
    this.panX=clamp(this.panX,visibleX-width*this.scale,width-visibleX);
    this.panY=clamp(this.panY,visibleY-height*this.scale,height-visibleY);
  }
  finishInput({commit=true}={}){
    if(this.current){if(commit)this.finishCurrent();else this.cancelCurrent();}
    const pointers=[...this.pointers];this.pointers.clear();this.panDrag=this.gesture=null;this.drawingPointerId=null;
    for(const [id,pointer] of pointers)if(pointer.target?.hasPointerCapture?.(id))pointer.target.releasePointerCapture(id);
    this.renderInputState();
  }
  beginGesture(){
    const touches=[...this.pointers.values()].filter(pointer=>pointer.type==="touch");
    if(touches.length<2)return;
    if(this.current)this.cancelCurrent();this.panDrag=null;
    const [a,b]=touches;
    this.gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),midX:(a.x+b.x)/2,midY:(a.y+b.y)/2,scale:this.scale,panX:this.panX,panY:this.panY};
    this.renderInputState();
  }
  beginPan(id,pointer){this.panDrag={id,x:pointer.x,y:pointer.y,panX:this.panX,panY:this.panY};this.renderInputState();}
  pointerDown(event){
    if(!this.activeEnabled||(event.pointerType==="mouse"&&event.button>0)||this.pointers.has(event.pointerId))return;
    event.preventDefault();
    const type=event.pointerType||"mouse",hasPen=[...this.pointers.values()].some(pointer=>pointer.type==="pen");
    if(type==="touch"&&hasPen)return;
    if(type==="pen"&&[...this.pointers.values()].some(pointer=>pointer.type==="touch"))this.finishInput({commit:false});
    const pointer={x:event.clientX,y:event.clientY,type,target:event.currentTarget};
    event.currentTarget.setPointerCapture?.(event.pointerId);this.pointers.set(event.pointerId,pointer);
    if([...this.pointers.values()].filter(item=>item.type==="touch").length>=2){this.beginGesture();return;}
    if(this.tool==="pan"){if(!this.panDrag)this.beginPan(event.pointerId,pointer);return;}
    if(this.readOnly||this.current)return;
    const rect=this.stage.getBoundingClientRect(),x=(event.clientX-rect.left-this.panX)/this.scale,y=(event.clientY-rect.top-this.panY)/this.scale;
    if(x<0||x>rect.width||y<0||y>rect.height)return;
    this.drawingPointerId=event.pointerId;
    if(this.tool==="eraser"){this.eraseAt(this.coords(event));return;}
    const now=event.timeStamp;
    this.current={id:strokeId(),tool:"pen",color:this.color,width:this.width,opacity:1,smooth:this.smoothing,points:[this.point(event,now)],createdAt:Date.now(),authorUid:this.uid,_start:now,_pointerId:event.pointerId,_pointerType:type};this.renderAll();
  }
  pointerMove(event){
    if(!this.pointers.has(event.pointerId)||!this.activeEnabled)return;
    event.preventDefault();const pointer=this.pointers.get(event.pointerId);pointer.x=event.clientX;pointer.y=event.clientY;
    const touches=[...this.pointers.values()].filter(item=>item.type==="touch");
    if(touches.length>=2&&this.gesture){
      const [a,b]=touches,distance=Math.hypot(a.x-b.x,a.y-b.y),midX=(a.x+b.x)/2,midY=(a.y+b.y)/2;
      this.scale=clamp(this.gesture.scale*distance/Math.max(this.gesture.distance,1),.25,4);
      this.panX=this.gesture.panX+(midX-this.gesture.midX);this.panY=this.gesture.panY+(midY-this.gesture.midY);
      this.constrainPan();this.notifyViewChange();this.renderAll();return;
    }
    if(this.tool==="pan"&&this.panDrag?.id===event.pointerId){
      this.panX=this.panDrag.panX+event.clientX-this.panDrag.x;this.panY=this.panDrag.panY+event.clientY-this.panDrag.y;
      this.constrainPan();this.notifyViewChange();this.renderAll();return;
    }
    if(this.readOnly||event.pointerId!==this.drawingPointerId)return;
    if(this.tool==="eraser"){const samples=event.getCoalescedEvents?.()||[event];for(const sample of samples.length?samples:[event])this.eraseAt(this.coords(sample));return;}
    if(!this.current||event.pointerId!==this.current._pointerId)return;
    const samples=event.getCoalescedEvents?.()||[event];
    for(const sample of samples.length?samples:[event]){const point=this.point(sample,this.current._start),last=this.current.points.at(-1);if(Math.hypot(point[0]-last[0],point[1]-last[1])>.0007)this.current.points.push(point);if(this.current.points.length>=500){this.finishCurrent();break;}}
    this.renderAll();if(this.current)this.onActive?.(this.serialize(this.current));
  }
  pointerUp(event){this.endPointer(event,true);}
  pointerCancel(event){this.endPointer(event,false);}
  endPointer(event,sample){
    const pointer=this.pointers.get(event.pointerId);if(!pointer)return;event.preventDefault();
    if(sample&&this.panDrag?.id===event.pointerId)this.pointerMove(event);
    if(sample&&this.current&&event.pointerId===this.current._pointerId){const point=this.point(event,this.current._start),last=this.current.points.at(-1);if(Math.hypot(point[0]-last[0],point[1]-last[1])>.0007&&this.current.points.length<500)this.current.points.push(point);}
    const hadGesture=Boolean(this.gesture);this.pointers.delete(event.pointerId);
    if(pointer.target?.hasPointerCapture?.(event.pointerId))pointer.target.releasePointerCapture(event.pointerId);
    if(this.panDrag?.id===event.pointerId)this.panDrag=null;
    if(event.pointerId===this.drawingPointerId){if(this.current)this.finishCurrent();else this.drawingPointerId=null;}
    this.gesture=null;
    if(hadGesture){
      const touches=[...this.pointers].filter(([,item])=>item.type==="touch");
      if(touches.length>=2)this.beginGesture();
      else if(touches.length===1&&this.tool==="pan")this.beginPan(...touches[0]);
    }
    this.renderInputState();
  }
  cancelCurrent(){this.current=null;this.drawingPointerId=null;this.onActive?.(null);this.renderAll();}
  finishCurrent(){if(!this.current)return;const stroke=this.current;this.current=null;this.drawingPointerId=null;if(stroke.points.length===1)stroke.points.push([...stroke.points[0].slice(0,3),1]);this.strokes[this.editableLayer].set(stroke.id,this.serialize(stroke));this.undoStack.push({type:"add",stroke:this.serialize(stroke)});this.redoStack=[];this.onActive?.(null);this.onComplete?.(this.serialize(stroke));this.renderAll();}
  serialize(stroke){const copy={...stroke};delete copy._start;delete copy._pointerId;delete copy._pointerType;return copy;}
  eraseAt(point){const map=this.strokes[this.editableLayer];for(const stroke of [...map.values()].reverse()){const hit=stroke.points.some((p,i)=>i&&distanceToSegment(point,stroke.points[i-1],p)<=Math.max(10,20/this.scale)/Math.min(this.cssWidth,this.cssHeight));if(hit){map.delete(stroke.id);this.undoStack.push({type:"remove",stroke});this.redoStack=[];this.onRemove?.(stroke.id);this.renderAll();break;}}}
  addStroke(layer,id,stroke){this.strokes[layer].set(id,{...stroke,id});this.renderAll();} removeStroke(layer,id){this.strokes[layer].delete(id);this.renderAll();} clearLayerLocal(layer){this.strokes[layer].clear();this.renderAll();}
  async undo(){if(this.readOnly||!this.activeEnabled)return;this.finishInput();const action=this.undoStack.pop();if(!action)return;this.redoStack.push(action);const map=this.strokes[this.editableLayer];if(action.type==="add"){map.delete(action.stroke.id);await this.onRemove?.(action.stroke.id);}else{map.set(action.stroke.id,action.stroke);await this.onComplete?.(action.stroke);}this.renderAll();}
  async redo(){if(this.readOnly||!this.activeEnabled)return;this.finishInput();const action=this.redoStack.pop();if(!action)return;this.undoStack.push(action);const map=this.strokes[this.editableLayer];if(action.type==="add"){map.set(action.stroke.id,action.stroke);await this.onComplete?.(action.stroke);}else{map.delete(action.stroke.id);await this.onRemove?.(action.stroke.id);}this.renderAll();}
  notifyViewChange(){this.onViewChange?.({scale:this.scale,panX:this.panX,panY:this.panY});}
  zoomBy(delta){
    this.finishInput();
    const nextScale=clamp(Math.round((this.scale+delta)*1e6)/1e6,.25,4);
    if(nextScale===this.scale)return;
    const {width,height}=this.stage.getBoundingClientRect(),ratio=nextScale/this.scale;
    this.panX=width/2-(width/2-this.panX)*ratio;
    this.panY=height/2-(height/2-this.panY)*ratio;
    this.scale=nextScale;this.constrainPan();this.notifyViewChange();this.renderAll();
  }
  resetZoom(){this.finishInput();this.scale=1;this.panX=0;this.panY=0;this.notifyViewChange();this.renderAll();}
  context(canvas){const dpr=window.devicePixelRatio||1,ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.cssWidth,this.cssHeight);ctx.translate(this.panX,this.panY);ctx.scale(this.scale,this.scale);return ctx;}
  renderBackground(){const ctx=this.context(this.backgroundCanvas),w=this.cssWidth,h=this.cssHeight;ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#e7eff1";ctx.lineWidth=1;const s=40;for(let x=0;x<w;x+=s){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=s){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}}
  renderLayer(canvas,layer){const ctx=this.context(canvas);for(const stroke of this.strokes[layer].values())this.drawStroke(ctx,stroke);if(this.current&&layer===this.editableLayer)this.drawStroke(ctx,this.current);}
  drawStroke(ctx,stroke){drawStrokeOnCanvas(ctx,stroke,this.cssWidth,this.cssHeight);}
  renderAll(){if(!this.cssWidth)return;this.renderBackground();this.renderLayer(this.studentCanvas,"studentStrokes");this.renderLayer(this.teacherCanvas,"teacherStrokes");}
  exportCanvas(drawBetweenLayers){const c=document.createElement("canvas");c.width=1600;c.height=1200;const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);const oldW=this.cssWidth,oldH=this.cssHeight;this.cssWidth=1600;this.cssHeight=1200;for(const stroke of this.strokes.studentStrokes.values())this.drawStroke(ctx,stroke);drawBetweenLayers?.(ctx,c);for(const stroke of this.strokes.teacherStrokes.values())this.drawStroke(ctx,stroke);this.cssWidth=oldW;this.cssHeight=oldH;return c;}
  destroy(){this.finishInput({commit:false});this.resizeObserver.disconnect();const input=this.editableLayer==="studentStrokes"?this.studentCanvas:this.teacherCanvas;if(input){input.removeEventListener("pointerdown",this.handleDown);input.removeEventListener("pointermove",this.handleMove);input.removeEventListener("pointerup",this.handleUp);input.removeEventListener("pointercancel",this.handleCancel);input.removeEventListener("lostpointercapture",this.handleCancel);this.stage.removeEventListener("dblclick",this.preventBrowserGesture);for(const name of ["gesturestart","gesturechange","gestureend"])this.stage.removeEventListener(name,this.preventBrowserGesture);}}
}
