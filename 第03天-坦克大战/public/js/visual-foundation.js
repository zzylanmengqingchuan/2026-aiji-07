(function(global){
  'use strict';

  const PALETTE=Object.freeze({
    sky:'#9fc7d4',
    skyWarm:'#ead5a7',
    sand:'#c99558',
    sandDark:'#8d6842',
    grass:'#5f7e45',
    grassDark:'#31563a',
    forest:'#263f32',
    concrete:'#737970',
    wood:'#825a38',
    track:'#24241e',
    teamGreen:'#4f8d5c',
    teamOrange:'#d85c41',
    teamBlue:'#4f78a8',
    teamGold:'#d6aa3d',
    uiInk:'#18212b',
    uiPanel:'#263340',
    accent:'#f0c94d',
    glow:'#ffd27a',
  });

  function seeded(seed){
    let value=seed>>>0;
    return function(){ value=(value*1664525+1013904223)>>>0; return value/4294967296; };
  }

  function canvas2d(size){
    if(typeof OffscreenCanvas!=='undefined') return new OffscreenCanvas(size,size);
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=size; return canvas;
  }

  function createGroundCanvas(size=512){
    const canvas=canvas2d(size),ctx=canvas.getContext('2d'),rand=seeded(20260718);
    ctx.fillStyle=PALETTE.sand; ctx.fillRect(0,0,size,size);

    // 大尺度柔和斑驳，避免只有高频噪点导致“电视雪花”。
    for(let i=0;i<95;i++){
      const x=rand()*size,y=rand()*size,r=(.025+rand()*.11)*size;
      const light=rand()>.48;
      const grad=ctx.createRadialGradient(x,y,0,x,y,r);
      grad.addColorStop(0,light?'rgba(255,224,166,.13)':'rgba(91,61,36,.11)');
      grad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }

    // 细颗粒与少量石粒，所有随机数固定，截图结果可重复。
    for(let i=0;i<15000;i++){
      const light=rand()>.54,alpha=.025+rand()*.075,sizePx=.35+rand()*1.45;
      ctx.fillStyle=light?`rgba(255,232,188,${alpha})`:`rgba(75,49,30,${alpha})`;
      ctx.fillRect(rand()*size,rand()*size,sizePx,sizePx);
    }
    for(let i=0;i<150;i++){
      ctx.fillStyle=rand()>.5?'rgba(93,69,47,.20)':'rgba(236,200,137,.24)';
      const x=rand()*size,y=rand()*size,r=.7+rand()*2.1;
      ctx.beginPath();ctx.ellipse(x,y,r,r*(.45+rand()*.5),rand()*Math.PI,0,Math.PI*2);ctx.fill();
    }
    return canvas;
  }

  function createGroundTexture(THREE,size=512){
    const texture=new THREE.CanvasTexture(createGroundCanvas(size));
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.repeat.set(7,7);
    texture.encoding=THREE.sRGBEncoding;
    texture.needsUpdate=true;
    return texture;
  }

  function createCamoTexture(THREE,base=PALETTE.teamGreen,accent=PALETTE.forest,size=256){
    const canvas=canvas2d(size),ctx=canvas.getContext('2d'),rand=seeded(parseInt(base.slice(1),16));
    ctx.fillStyle=base;ctx.fillRect(0,0,size,size);
    // 低对比度的大色块比细碎迷彩更接近平涂玩具质感，也减少纹理闪烁。
    for(let i=0;i<24;i++){
      ctx.globalAlpha=i%3===0?.16:.1;
      ctx.fillStyle=i%3===0?accent:PALETTE.sand;
      const x=rand()*size,y=rand()*size,w=26+rand()*58,h=14+rand()*38;
      ctx.beginPath();ctx.ellipse(x,y,w,h,rand()*Math.PI,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(1.5,2);texture.encoding=THREE.sRGBEncoding;return texture;
  }

  const VignetteShader={
    uniforms:{tDiffuse:{value:null},strength:{value:.48},softness:{value:.42}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform sampler2D tDiffuse; uniform float strength; uniform float softness; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);float d=distance(vUv,vec2(.5));float v=smoothstep(softness,.82,d);c.rgb*=1.0-v*strength;gl_FragColor=c;}',
  };

  global.TankVisuals={PALETTE,createGroundCanvas,createGroundTexture,createCamoTexture,VignetteShader};
})(window);
