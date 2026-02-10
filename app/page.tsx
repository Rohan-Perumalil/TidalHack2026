"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";

const polarShader = {
  uniforms: {
    uBaseMap: { value: null as THREE.Texture | null },
    uPolarCutoff: { value: 0.55 },
    uPolarFeather: { value: 0.08 },
    uPolarColor: { value: new THREE.Color("#f8fbff") },
  },
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    varying vec2 vUv;
    void main() {
      vPos = normalize(position);
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vPos;
    varying vec2 vUv;
    uniform sampler2D uBaseMap;
    uniform float uPolarCutoff;
    uniform float uPolarFeather;
    uniform vec3 uPolarColor;

    void main() {
      vec3 baseColor = texture2D(uBaseMap, vUv).rgb;
      float lat = vPos.y; // -1 to 1
      float maskNorth = smoothstep(uPolarCutoff, uPolarCutoff + uPolarFeather, lat);
      float maskSouth = smoothstep(uPolarCutoff, uPolarCutoff + uPolarFeather, -lat);
      float mask = clamp(maskNorth + maskSouth, 0.0, 1.0);
      vec3 color = mix(baseColor, uPolarColor, mask);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function Globe() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const texture = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size * 0.35, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.55);
    grad.addColorStop(0, "#8fc4ff");
    grad.addColorStop(0.6, "#3b6fb0");
    grad.addColorStop(1, "#1f3d70");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      ...polarShader,
      uniforms: {
        ...polarShader.uniforms,
        uBaseMap: { value: texture },
      },
      lights: false,
    });
    return mat;
  }, [texture]);

  useFrame((_, delta) => {
    meshRef.current.rotation.y += delta * 0.2; // slow idle spin
  });

  return (
    <mesh ref={meshRef} scale={0.25}>
      <sphereGeometry args={[1, 96, 96]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function CameraTimeline({
  onSnowPhase,
  onWhiteHold,
  onRevealWinter,
}: {
  onSnowPhase: (t: number) => void;
  onWhiteHold: () => void;
  onRevealWinter: () => void;
}) {
  const { camera, scene } = useThree();
  const [started, setStarted] = useState(false);
  const globeRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    globeRef.current = scene.children.find((c) => (c as THREE.Mesh).isMesh) || null;
  }, [scene]);

  useEffect(() => {
    if (!globeRef.current || started) return;
    setStarted(true);
    camera.position.set(0, 0, 4.5);
    camera.lookAt(0, 0, 0);

    const tl = gsap.timeline({
      onUpdate: () => {
        const progress = tl.progress();
        if (progress > 0.8) {
          onSnowPhase(progress);
        }
        camera.updateProjectionMatrix();
      },
    });

    // 1) slow spin hold (globe spins via useFrame)
    tl.to({}, { duration: 1.5 });
    // 2) rotate camera/globe to north pole
    tl.to(globeRef.current.rotation, {
      x: -Math.PI / 2,
      y: "+=0.5",
      duration: 1.6,
      ease: "power2.inOut",
    }, "-=0.2");
    // 3) zoom in until globe fills screen
    tl.to(
      camera.position,
      {
        z: 1.0,
        duration: 1.8,
        ease: "power2.inOut",
      },
      "-=0.3"
    );
    // short white hold before reveal
    tl.to({}, { duration: 0.3, onComplete: onWhiteHold });
    // trigger reveal
    tl.call(onRevealWinter);
    return () => {
      tl.kill();
    };
  }, [camera, onSnowPhase, started]);

  return null;
}

export default function Page() {
  const [snowOpacity, setSnowOpacity] = useState(0);
  const [winterVisible, setWinterVisible] = useState(false);
  const [snowOn, setSnowOn] = useState(false);
  const [globeVisible, setGlobeVisible] = useState(true);
  const whiteHoldRef = useRef(false);
  const penguinRef = useRef<HTMLImageElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);

  const handleSnowPhase = (progress: number) => {
    // progress 0.8 -> 1 maps to opacity 0 -> 1
    const t = Math.min(Math.max((progress - 0.8) / 0.2, 0), 1);
    setSnowOpacity(t);
  };

  const handleWhiteHold = () => {
    whiteHoldRef.current = true;
  };

  const handleReveal = () => {
    setWinterVisible(true);
    setSnowOn(true);
    setGlobeVisible(false);
    // fade snow overlay out after reveal starts
    setTimeout(() => setSnowOpacity(0), 200);
    // Penguin entrance then cards
    const tl = gsap.timeline();
    if (penguinRef.current) {
      tl.set(penguinRef.current, { opacity: 0, x: "-35vw", y: "0vh", rotate: "-1deg" });
      tl.to(penguinRef.current, {
        duration: 1.0,
        x: "0vw",
        y: "0vh",
        opacity: 1,
        rotate: "1deg",
        ease: "back.out(1.4)",
      });
      tl.to(penguinRef.current, { duration: 0.3, rotate: "0deg", ease: "sine.out" }, "-=0.3");
    }
    if (cardsRef.current) {
      tl.to(cardsRef.current, { opacity: 1, translateY: 0, duration: 0.6, ease: "power2.out" }, "-=0.2");
    }
  };

  return (
    <main className="stage">
      <div className="layer" style={{ zIndex: 0 }}>
        <Canvas
          style={{ opacity: globeVisible ? 1 : 0, transition: "opacity 0.5s ease" }}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, 4.5], fov: 45, near: 0.1, far: 50 }}
        >
          <color attach="background" args={["#0c1d3a"]} />
          <fog attach="fog" args={["#cfe7ff", 6, 14]} />
          <ambientLight intensity={0.7} color="#bfdcff" />
          <directionalLight intensity={0.7} color="#ffffff" position={[2, 2, 3]} />
          <Globe />
          <CameraTimeline
            onSnowPhase={handleSnowPhase}
            onWhiteHold={handleWhiteHold}
            onRevealWinter={handleReveal}
          />
        </Canvas>
      </div>

      <div className="layer winter-bg" style={{ opacity: winterVisible ? 1 : 0 }} />
      <div className="layer overlay-ice" />
      <div className="layer overlay-snow" style={{ opacity: snowOpacity }} />
      <div className={`layer snowfield ${snowOn ? "snow-on" : ""}`} />

      <div className="layer content-layer">
        <div ref={cardsRef} className="cards">
          <div className="card">Data</div>
          <div className="card">Analytics</div>
        </div>
      </div>

      <img
        ref={penguinRef}
        className="penguin"
        src="/penguin.png"
        alt="Penguin guide"
      />
    </main>
  );
}
