// Adapted from React Bits SpecularButton-JS-CSS for PeAS link semantics and motion preferences.
import { useEffect, useRef, type ReactNode } from "react";
import { Color, Mesh, Program, Renderer, Triangle } from "ogl";
import "./SpecularButton.css";

const PAD = 20;
const VERT = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}`;
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter; uniform vec2 uHalfSize; uniform float uRadius; uniform float uAngle;
uniform float uPx; uniform vec3 uLineColor; uniform vec3 uBaseColor; uniform float uIntensity;
uniform float uShineSize; uniform float uShineFade; uniform float uThickness; uniform float uBaseWidth;
out vec4 fragColor;
float rr(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
void main(){
 vec2 p=gl_FragCoord.xy-uCenter; float d=rr(p,uHalfSize,uRadius); vec2 l=vec2(cos(uAngle),sin(uAngle));
 float base=(1.-smoothstep(0.,uBaseWidth,abs(d)))*.5;
 vec2 n=normalize(p/(uHalfSize*uHalfSize)+1e-6); float phi=acos(clamp(abs(dot(n,l)),0.,1.));
 float rim=1.-smoothstep(uShineSize-uShineFade,uShineSize+uShineFade+1e-4,phi);
 float x=d/(uThickness+1e-6); float line=exp(-mix(1.,1.6,smoothstep(0.,1.5,x))*x*x);
 float hi=line*rim*(1.-smoothstep(.5*uPx,3.*uPx,abs(d)))*uIntensity;
 vec3 col=uBaseColor*base+uLineColor*hi; fragColor=vec4(col,clamp(base+hi,0.,1.));
}`;

type SpecularButtonProps = {
  children: ReactNode;
  href: string;
  className?: string;
  radius?: number;
  lineColor?: string;
  baseColor?: string;
};

export default function SpecularButton({
  children,
  href,
  className = "",
  radius = 16,
  lineColor = "#fff1a8",
  baseColor = "#8a6300",
}: SpecularButtonProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const fxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const link = linkRef.current;
    const fx = fxRef.current;
    if (!link || !fx) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    } catch {
      return;
    }
    const gl = renderer.gl;
    const dpr = renderer.dpr;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;
    const program = new Program(gl, { vertex: VERT, fragment: FRAG, uniforms: {
      uCenter:{value:[0,0]},uHalfSize:{value:[1,1]},uRadius:{value:0},uAngle:{value:2.4},uPx:{value:dpr},
      uLineColor:{value:[1,1,1]},uBaseColor:{value:[.54,.39,0]},uIntensity:{value:1},uShineSize:{value:.2},
      uShineFade:{value:.7},uThickness:{value:1.25*dpr},uBaseWidth:{value:dpr},
    }});
    const mesh = new Mesh(gl, { geometry, program });
    fx.appendChild(gl.canvas);
    const line = new Color(lineColor);
    const base = new Color(baseColor);
    program.uniforms.uLineColor.value = [line.r, line.g, line.b];
    program.uniforms.uBaseColor.value = [base.r, base.g, base.b];
    const size = { w: 1, h: 1 };
    const resize = () => {
      const rect = link.getBoundingClientRect(); size.w=rect.width; size.h=rect.height;
      renderer.setSize(rect.width+PAD*2,rect.height+PAD*2);
      program.uniforms.uCenter.value=[(PAD+rect.width/2)*dpr,(PAD+rect.height/2)*dpr];
      program.uniforms.uHalfSize.value=[rect.width/2*dpr,rect.height/2*dpr];
      program.uniforms.uRadius.value=Math.min(radius,rect.height/2)*dpr;
    };
    const ro = new ResizeObserver(resize); ro.observe(link); resize();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let pointerAngle: number | null = null, proximity = 0, angle = 2.4, idle = 2.4, bright = reduced ? .75 : 0, raf = 0, last = performance.now();
    const move = (event: PointerEvent) => {
      const rect=link.getBoundingClientRect(), cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
      const dx=Math.max(rect.left-event.clientX,0,event.clientX-rect.right), dy=Math.max(rect.top-event.clientY,0,event.clientY-rect.bottom);
      const distance=Math.hypot(dx,dy); pointerAngle=Math.atan2(cy-event.clientY,event.clientX-cx);
      const t=Math.max(0,1-distance/240); proximity=t*t*(3-2*t);
    };
    const draw = (now: number) => {
      const dt=Math.min((now-last)/1000,.05); last=now; idle+=.28*dt;
      const target=pointerAngle !== null && proximity>0 ? pointerAngle : idle;
      angle+=(((target-angle+Math.PI*3)%(Math.PI*2))-Math.PI)*(1-Math.exp(-dt*7));
      bright+=((proximity || .45)-bright)*(1-Math.exp(-dt*8));
      program.uniforms.uAngle.value=angle; program.uniforms.uIntensity.value=1.35*bright;
      renderer.render({scene:mesh}); raf=requestAnimationFrame(draw);
    };
    window.addEventListener("pointermove",move,{passive:true});
    if (reduced) { program.uniforms.uIntensity.value=.8; renderer.render({scene:mesh}); } else raf=requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("pointermove",move); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [baseColor, lineColor, radius]);

  return <a ref={linkRef} href={href} className={`specular-button specular-button--lg ${className}`.trim()} style={{ "--sb-radius": `${radius}px` } as React.CSSProperties}>
    <span ref={fxRef} className="specular-button__fx" aria-hidden="true" />
    <span className="specular-button__label">{children}</span>
  </a>;
}
