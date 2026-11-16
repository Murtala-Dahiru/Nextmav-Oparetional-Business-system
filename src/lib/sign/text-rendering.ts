import type {PDFFont,PDFPage} from 'pdf-lib';
import type {Field} from './model';
// Fit the complete value inside the assigned rectangle; never silently truncate evidence.
export function drawFieldText(page:PDFPage,font:PDFFont,text:string,box:{x:number;y:number;width:number;height:number},f:Field,appearance:{scale:number;x:number;y:number}){
 const signature=['signature','initials'].includes(f.type);
 const minimum=f.inputMode===undefined||signature?.5:6;
 let size=Math.min(f.fontSize??(signature?36:12),box.height*.7)*appearance.scale;
 const width=Math.max(1,box.width-2);
 function linesAt(size:number){
  if(!f.multiline)return [text.replace(/\r?\n/g,' ')];
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r/g,'').split('\n')){let line='';for(const char of Array.from(paragraph)){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}lines.push(line);}
  return lines;
 }
 let lines=linesAt(size);
 while(size>minimum&&(lines.some(line=>font.widthOfTextAtSize(line,size)>width)||lines.length*size*1.2>box.height)){size=Math.max(minimum,size-.25);lines=linesAt(size);}
 if(size<minimum||lines.some(line=>font.widthOfTextAtSize(line,size)>width)||lines.length*size*1.2>box.height)throw Error('Text is too long for '+(f.label||f.type)+'. Shorten the value or ask the sender to enlarge the field');
 const alignment=f.alignment==='center'?.5:f.alignment==='right'?1:signature?appearance.x:0;
 const block=lines.length*size*1.2;
 lines.forEach((line,i)=>page.drawText(line,{x:box.x+Math.max(0,box.width-font.widthOfTextAtSize(line,size))*alignment,y:box.y+(box.height-block)*(1-appearance.y)+block-size-i*size*1.2,size,font}));
}
