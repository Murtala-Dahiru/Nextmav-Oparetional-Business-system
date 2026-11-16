import sharp from 'sharp';
export async function cleanSignature(value:string){
 if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value)||value.length>400000)throw Error('Use a PNG or JPEG signature under 300 KB');
 const image=sharp(Buffer.from(value.split(',')[1],'base64'),{limitInputPixels:4000000,failOn:'warning'});
 const metadata=await image.metadata();if(!['png','jpeg'].includes(metadata.format??'')||(metadata.pages??1)>1)throw Error('Unsupported signature image');
 const {data,info}=await image.rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {width,height}=info;const seen=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
 // Remove only virtually white, neutral pixels connected to an edge. Preserve
 // light coloured strokes and enclosed white details instead of global thresholding.
 const visit=(n:number)=>{if(seen[n])return;seen[n]=1;const i=n*4,r=data[i],g=data[i+1],b=data[i+2];if(data[i+3]===0||(Math.min(r,g,b)>=250&&Math.max(r,g,b)-Math.min(r,g,b)<=2)){data[i+3]=0;queue[tail++]=n;}};
 for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x);}for(let y=0;y<height;y++){visit(y*width);visit(y*width+width-1);}while(head<tail){const n=queue[head++],x=n%width,y=Math.floor(n/width);if(x)visit(n-1);if(x<width-1)visit(n+1);if(y)visit(n-width);if(y<height-1)visit(n+width);}
 let left=width,top=height,right=-1,bottom=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(data[(y*width+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 if(right<left)throw Error('The image contains no visible signature');
 const bytes=await sharp(data,{raw:{width,height,channels:4}}).extract({left,top,width:right-left+1,height:bottom-top+1}).resize({width:1200,height:400,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 return 'data:image/png;base64,'+bytes.toString('base64');
}
