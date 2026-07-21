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
    ctx.fillStyle=PALETTE.grass; ctx.fillRect(0,0,size,size);

    // 大尺度柔和斑驳，避免只有高频噪点导致“电视雪花”。
    for(let i=0;i<95;i++){
      const x=rand()*size,y=rand()*size,r=(.025+rand()*.11)*size;
      const light=rand()>.48;
      const grad=ctx.createRadialGradient(x,y,0,x,y,r);
      grad.addColorStop(0,light?'rgba(190,210,118,.14)':'rgba(25,70,40,.13)');
      grad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }

    // 细颗粒与少量石粒，所有随机数固定，截图结果可重复。
    for(let i=0;i<15000;i++){
      const light=rand()>.54,alpha=.025+rand()*.075,sizePx=.35+rand()*1.45;
      ctx.fillStyle=light?`rgba(205,220,139,${alpha})`:`rgba(25,67,37,${alpha})`;
      ctx.fillRect(rand()*size,rand()*size,sizePx,sizePx);
    }
    for(let i=0;i<150;i++){
      ctx.fillStyle=rand()>.5?'rgba(72,91,48,.20)':'rgba(139,156,78,.24)';
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

  // 迷宫矮墙砖纹：赭石灰浆错缝砖，低饱和，与军事色板统一。
  function createBrickCanvas(size=256){
    const canvas=canvas2d(size),ctx=canvas.getContext('2d'),rand=seeded(20260720);
    ctx.fillStyle='#6f756c'; ctx.fillRect(0,0,size,size); // 灰浆底色（concrete 调）
    const rows=6, cols=3, bh=size/rows, bw=size/cols;
    const brickTones=['#9a7350','#8d6842','#83603d','#a07a55'];
    for(let r=0;r<rows;r++){
      const off=(r%2)*bw*.5;
      for(let c=-1;c<=cols;c++){
        const x=c*bw+off, y=r*bh;
        ctx.fillStyle=brickTones[(rand()*brickTones.length)|0];
        ctx.fillRect(x+2,y+2,bw-4,bh-4);
        ctx.fillStyle='rgba(255,228,185,.10)'; ctx.fillRect(x+2,y+2,bw-4,3); // 顶面受光
        ctx.fillStyle='rgba(38,24,14,.20)'; ctx.fillRect(x+2,y+bh-5,bw-4,3); // 底面阴影
        if(rand()>.62){ ctx.fillStyle='rgba(52,36,22,.16)'; ctx.fillRect(x+4+rand()*bw*.5,y+6+rand()*bh*.4,3+rand()*7,2+rand()*4); }
      }
    }
    // 细颗粒降噪感，固定种子保证截图可复现
    for(let i=0;i<2600;i++){
      const light=rand()>.5,a=.02+rand()*.05;
      ctx.fillStyle=light?`rgba(255,232,190,${a})`:`rgba(46,30,18,${a})`;
      ctx.fillRect(rand()*size,rand()*size,.8+rand()*1.4,.8+rand()*1.4);
    }
    return canvas;
  }

  function createBrickTexture(THREE,size=256){
    const texture=new THREE.CanvasTexture(createBrickCanvas(size));
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
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

  global.TankVisuals={PALETTE,createGroundCanvas,createGroundTexture,createBrickTexture,createCamoTexture,VignetteShader};
})(window);
