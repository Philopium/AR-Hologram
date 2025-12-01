// Usa URL completi invece di nomi di moduli
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

// Configuration
const MODEL_URL = './models/model.glb'; // drop your model here
const TARGETS_MIND = './targets/targets.mind'; // put generated .mind target in targets/

// Light & smoothing config
const LUMINANCE_SMOOTHING = 0.08; // lower = smoother/slower
const TRANSFORM_SMOOTHING = 0.15; // 0..1, higher = snappier
const SAMPLE_SIZE = 32; // downscale size for camera sampling

(async() => {
  // MindAR init
  const mindarThree = new MindARThree({
    container: document.querySelector('#ar-container'),
    imageTargetSrc: TARGETS_MIND,
    uiScanning: false,
    uiLoading: false,
    maxTrack: 1, // single target
  });

  const {renderer, scene, camera} = mindarThree;

  // Create lights (we will adapt these at runtime)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0, 1, 0);
  dir.castShadow = false;
  scene.add(dir);

  // Anchor (we'll use it as the *source* transform, but render the model in a separate visual group that is smoothed)
  const anchor = mindarThree.addAnchor(0);

  // Visual group: scene root child that will be smoothed toward the anchor world transform
  const visualGroup = new THREE.Group();
  visualGroup.visible = false;
  scene.add(visualGroup);

  // Load model and prepare animation mixer
  const loader = new GLTFLoader();
  let mixer = null;

  try {
    const gltf = await loader.loadAsync(MODEL_URL);
    // Add model to visualGroup (NOT to anchor) so we can smooth its world transform toward anchor's
    visualGroup.add(gltf.scene);

    // Normalize model size to fit target plane if necessary
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = 0.5 / maxDim;
      gltf.scene.scale.setScalar(scale);
    }

    // Prepare animation mixer
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach(clip => {
        const action = mixer.clipAction(clip);
        action.loop = THREE.LoopRepeat;
        action.play();
      });
    }
  } catch(err) {
    console.error('Failed to load model:', err);
  }

  // Hidden canvas for sampling camera frames to estimate lighting
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_SIZE;
  sampleCanvas.height = SAMPLE_SIZE;
  const sampleCtx = sampleCanvas.getContext('2d');

  // Smoothing state for luminance and color
  let smoothedLuminance = 0.8;
  let smoothedColor = new THREE.Color(1,1,1);

  // Helper to compute average color and luminance from video element
  function sampleVideoFrame(videoElem) {
    try {
      if (videoElem.readyState < 2) return null;
      // draw downscaled video into canvas
      sampleCtx.drawImage(videoElem, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const data = sampleCtx.getImageData(0,0,SAMPLE_SIZE,SAMPLE_SIZE).data;
      let r=0,g=0,b=0;
      const pxCount = SAMPLE_SIZE*SAMPLE_SIZE;
      for (let i=0;i<data.length;i+=4){
        r += data[i];
        g += data[i+1];
        b += data[i+2];
      }
      r /= pxCount; g /= pxCount; b /= pxCount;
      // compute luminance (standard Rec.709)
      const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
      return { r: r/255, g: g/255, b: b/255, lum };
    } catch(e){
      return null;
    }
  }

  // Find the first video element MindAR creates (after start)
  function findMindarVideo() {
    // MindAR adds a video element under container; look for first <video>
    const vid = document.querySelector('#ar-container video');
    return vid || document.querySelector('video');
  }

  // Smoothing for transform: current world position/quaternion of visualGroup moves toward anchor world transform
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  const currentPos = new THREE.Vector3();
  const currentQuat = new THREE.Quaternion();

  // Start MindAR engine and animation loop
  await mindarThree.start(); // starts camera and tracking
  const videoElem = findMindarVideo();

  // Ensure visualGroup hidden until anchor visible
  visualGroup.visible = false;

  // clock for mixer
  const clock = new THREE.Clock();

  renderer.setAnimationLoop((time) => {
    const delta = clock.getDelta();
    // Update mixer
    if (mixer) mixer.update(delta);

    // If anchor is visible (MindAR toggles anchor.group.visible), get its world transform
    if (anchor.group.visible) {
      // compute anchor world position/quat
      anchor.group.getWorldPosition(targetPos);
      anchor.group.getWorldQuaternion(targetQuat);

      // if visualGroup just became visible, snap to anchor to avoid pop
      if (!visualGroup.visible) {
        visualGroup.position.copy(targetPos);
        visualGroup.quaternion.copy(targetQuat);
        visualGroup.visible = true;
        currentPos.copy(targetPos);
        currentQuat.copy(targetQuat);
      } else {
        // lerp position
        currentPos.lerp(targetPos, TRANSFORM_SMOOTHING);
        // slerp quaternion
        currentQuat.slerp(targetQuat, TRANSFORM_SMOOTHING);
        visualGroup.position.copy(currentPos);
        visualGroup.quaternion.copy(currentQuat);
      }
    } else {
      // optionally hide when not tracked
      // visualGroup.visible = false;
    }

    // Light estimation sampling from video (basic average color + luminance)
    if (videoElem) {
      const sample = sampleVideoFrame(videoElem);
      if (sample) {
        // exponential smoothing
        smoothedLuminance = smoothedLuminance * (1 - LUMINANCE_SMOOTHING) + sample.lum * LUMINANCE_SMOOTHING;
        smoothedColor.r = smoothedColor.r * (1 - LUMINANCE_SMOOTHING) + sample.r * LUMINANCE_SMOOTHING;
        smoothedColor.g = smoothedColor.g * (1 - LUMINANCE_SMOOTHING) + sample.g * LUMINANCE_SMOOTHING;
        smoothedColor.b = smoothedColor.b * (1 - LUMINANCE_SMOOTHING) + sample.b * LUMINANCE_SMOOTHING;

        // Map luminance to plausible intensity range
        const ambientMin = 0.25;
        const ambientMax = 1.4;
        const ambientIntensity = ambientMin + (ambientMax - ambientMin) * Math.min(Math.max(smoothedLuminance, 0), 1);

        hemi.intensity = ambientIntensity;
        // set hemisphere sky color to sampled color (tinted)
        hemi.color.setRGB(smoothedColor.r, smoothedColor.g, smoothedColor.b);

        // directional light color slightly scaled and intensity mapped
        dir.color.setRGB(Math.max(smoothedColor.r*1.1, 0.8*smoothedColor.r),
                         Math.max(smoothedColor.g*1.05, 0.8*smoothedColor.g),
                         Math.max(smoothedColor.b*1.0, 0.8*smoothedColor.b));
        dir.intensity = 0.2 + smoothedLuminance * 1.2;
      }
    }

    renderer.render(scene, camera);
  });

  // Stop camera on pagehide to free resources
  const stop = async () => {
    try { await mindarThree.stop(); } catch(e){}
  };
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeunload', stop);
})();
