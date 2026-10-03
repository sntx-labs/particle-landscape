import * as THREE from 'three';

    const DEFAULT_HEIGHTMAP_URL = 'assets/heightmap_512x512.png';
    let activeHeightmap = DEFAULT_HEIGHTMAP_URL;
    // Track mouse for hover effects (canvasContainer defined after scene setup)
    window.__mouseNdc = new THREE.Vector2(-2, -2);
    

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0f13);

    const canvasContainer = document.getElementById('canvas-container');
    const camera = new THREE.PerspectiveCamera(55, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 1000);
    camera.position.set(0, 10, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    canvasContainer.appendChild(renderer.domElement);
    renderer.domElement.classList.add('drop-target');

    // Mouse tracking for hover effects and airplane direction control
    canvasContainer.addEventListener('pointermove', (e) => {
      const rect = canvasContainer.getBoundingClientRect();
      window.__mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      window.__mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      
      // Update airplane direction based on mouse position
      // X position controls turn rate (-1 to 1, continuous turning)
      // Y position controls climb rate (-1 to 1, continuous altitude change)
      mouseControl.active = true;
      mouseControl.turnRate = window.__mouseNdc.x;   // -1 (left) to 1 (right)
      mouseControl.climbRate = window.__mouseNdc.y;  // -1 (down) to 1 (up)
    });
    canvasContainer.addEventListener('pointerleave', () => {
      window.__mouseNdc.set(-2, -2);
      mouseControl.active = false;
    });

    // Mouse scroll for camera distance control
    // Min/max limits for each camera mode
    const cameraLimits = {
      chase: { min: 0.5, max: 8, param: 'chaseCamDistance', step: 0.2 },
      topdown: { min: 3, max: 20, param: 'topCamHeight', step: 0.5 },
      isometric: { min: 2, max: 15, param: 'isoCamDistance', step: 0.3 }
    };
    
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const mode = params?.cameraMode;
      if (!airplaneState.enabled) return;
      if (!mode || !cameraLimits[mode]) return;
      
      const limits = cameraLimits[mode];
      const direction = e.deltaY > 0 ? 1 : -1; // scroll down = zoom out (increase distance)
      const newValue = params[limits.param] + direction * limits.step;
      params[limits.param] = Math.max(limits.min, Math.min(limits.max, newValue));
      
      // Update pane to reflect change
      if (typeof pane !== 'undefined' && pane.refresh) {
        pane.refresh();
      }
    }, { passive: false });

    // Right-click drag for camera orbit around airplane
    const cameraOrbit = {
      isDragging: false,
      lastX: 0,
      lastY: 0,
      azimuth: 0,       // horizontal angle (radians)
      elevation: 0,     // vertical angle offset (radians) - for pitch adjustment
      sensitivity: 0.005,
      // Min/max elevation for each mode (radians)
      elevationLimits: {
        chase: { min: -0.3, max: 0.5 },
        topdown: { min: -0.2, max: 0.2 },  // limited for top-down
        isometric: { min: -0.4, max: 0.6 }
      }
    };

    canvasContainer.addEventListener('mousedown', (e) => {
      if (e.button === 2 && airplaneState.enabled) { // Right click
        cameraOrbit.isDragging = true;
        cameraOrbit.lastX = e.clientX;
        cameraOrbit.lastY = e.clientY;
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!cameraOrbit.isDragging) return;
      
      const deltaX = e.clientX - cameraOrbit.lastX;
      const deltaY = e.clientY - cameraOrbit.lastY;
      cameraOrbit.lastX = e.clientX;
      cameraOrbit.lastY = e.clientY;
      
      // Update azimuth (horizontal orbit)
      cameraOrbit.azimuth -= deltaX * cameraOrbit.sensitivity;
      
      // Update elevation (vertical angle) with limits based on mode
      const mode = params?.cameraMode || 'chase';
      const limits = cameraOrbit.elevationLimits[mode] || { min: -0.5, max: 0.5 };
      cameraOrbit.elevation = Math.max(limits.min, Math.min(limits.max, 
        cameraOrbit.elevation + deltaY * cameraOrbit.sensitivity
      ));
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        cameraOrbit.isDragging = false;
      }
    });

    // Prevent context menu on right-click
    canvasContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Touch support for mobile: tap to trigger radar pulse
    let touchStartTime = 0;
    let touchStartPos = { x: 0, y: 0 };
    const TAP_THRESHOLD_MS = 300;  // Max time for a tap
    const TAP_THRESHOLD_PX = 20;   // Max movement for a tap
    
    canvasContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartTime = performance.now();
        touchStartPos.x = e.touches[0].clientX;
        touchStartPos.y = e.touches[0].clientY;
      }
    }, { passive: true });
    
    canvasContainer.addEventListener('touchend', (e) => {
      const touchDuration = performance.now() - touchStartTime;
      
      // Check if this was a quick tap (not a drag or long press)
      if (touchDuration < TAP_THRESHOLD_MS && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartPos.x;
        const dy = e.changedTouches[0].clientY - touchStartPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // If finger didn't move much, treat as a tap and trigger radar
        if (distance < TAP_THRESHOLD_PX) {
          triggerRadarPulse();
        }
      }
    }, { passive: true });

    const clock = new THREE.Clock();
    const initialCamPos = new THREE.Vector3().copy(camera.position);
    const initialCamQuat = new THREE.Quaternion().copy(camera.quaternion);
    let defaultCamPos;
    let defaultCamQuat;
    

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    // Ground grid for scale reference
    const grid = new THREE.GridHelper(200, 200, 0x33353a, 0x1e2026);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    grid.material.depthWrite = false;
    grid.material.depthTest = false;
    grid.visible = false;
    scene.add(grid);

    // Plane setup
    const initialSize = 44; // default tile size
    let segments = 256; // will be controlled by UI (subdivisions)

    let plane = null; // unused after tiling in pointcloud mode
    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uScale: { value: 2.8 },
        uBias: { value: -2.8 * 0.5 },
        uColor: { value: new THREE.Color(0x8a8f9a) },
        uPointSize: { value: 2.0 },
        uTime: { value: 0.0 },
        uJitter: { value: 0.02 },
        uMaskCenter: { value: new THREE.Vector2(0.0, 0.0) },
        uMaskRadius: { value: 4.0 },
        uMaskAspect: { value: 1.5 },
        uViewportResolution: { value: new THREE.Vector2(1,1) },
        uViewportRadius: { value: new THREE.Vector2(0.49,0.43) },
        uViewportFeather: { value: 0.22 },
        uVignette: { value: 0.18 },
        uMaskFeather: { value: 0.6 },
        uHoverCenter: { value: new THREE.Vector2(9999.0, 9999.0) },
        uHoverRadius: { value: 1.6 },
        uHoverStrength: { value: 0.8 },
        uHoverSnap: { value: 2.0 },
        uHoverColor: { value: new THREE.Color(0xffcc55) },
        uHoverEnabled: { value: 1.0 },
        // Airplane hover highlight
        uAirplanePos: { value: new THREE.Vector3(9999, 9999, 9999) },
        uAirplaneHoverEnabled: { value: 0.0 },
        uAirplaneHoverRadius: { value: 2.0 },
        // Radar pulse
        uRadarActive: { value: 0.0 },
        uRadarOrigin: { value: new THREE.Vector3(0, 0, 0) },
        uRadarRadius: { value: 0.0 },
        uRadarRingWidth: { value: 0.6 },
        uRadarFade: { value: 1.0 },
        // Radar rain animation
        uRadarRainHeight: { value: 41.0 },     // How high particles start above final position
        uRadarRainDuration: { value: 0.35 },   // How long the fall animation takes (seconds)
        uRadarTime: { value: 0.0 },            // Current time since radar started
        uRadarExpandSpeed: { value: 9.72 },    // Units per second for ring expansion
        uRadarShowRing: { value: 0.0 },        // Whether to show the colored ring effect
        uRadarRingFeather: { value: 0.1 },     // Softness of the ring edges
        uPersistentRevealRadius: { value: 0.0 }, // Tracks max revealed area (doesn't reset on new pulse)
        // Rain and ring colors
        uRainColor: { value: new THREE.Color(0xbff4ff) },           // Color of falling particles
        uRadarRingColorLow: { value: new THREE.Color(0x00ccff) },   // Ring color for valleys
        uRadarRingColorMid: { value: new THREE.Color(0x00ff80) },   // Ring color for mid
        uRadarRingColorHigh: { value: new THREE.Color(0xffee33) },  // Ring color for peaks
        uRainColorFadeDuration: { value: 1.0 },                      // Time to crossfade from rain to ring color
        // Rain particle shape
        uRainParticleWidth: { value: 0.01 },
        uRainParticleLength: { value: 7.0 },
        uRainImpactScale: { value: 4.5 },
        uRainSpawnRadius: { value: 0.5 },  // How close to center particles originate (0 = exact center)
        uAirplaneColorFar: { value: new THREE.Color(0xff9000) },  // orange when high/safe
        uAirplaneColorClose: { value: new THREE.Color(0xff0000) }, // pure red when low/danger
        // Fog uniforms expected by renderer when material.fog === true
        fogColor: { value: new THREE.Color(0x0e0f13) },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
        fogDensity: { value: 0.00025 }
      },
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
      fog: true,
      vertexShader: `
        #include <uv_pars_vertex>
        varying float vMaskAlpha;
        varying float vHoverMix;
        varying float vAirplaneMix;
        varying float vAirplaneProximity;
        varying float vRadarMix;
        varying float vRadarHeight;
        varying float vRadarRainOpacity;
        varying float vRainColorBlend;
        varying float vRainProgress;
        varying vec2 vRainDirection;
        #include <fog_pars_vertex>
        uniform sampler2D uMap;
        uniform float uScale;
        uniform float uBias;
        uniform float uPointSize;
        uniform float uTime;
        uniform float uJitter;
        uniform vec2 uMaskCenter;
        uniform float uMaskRadius;
        uniform float uMaskAspect;
        uniform float uMaskFeather;
        uniform vec2 uHoverCenter;
        uniform float uHoverRadius;
        uniform float uHoverStrength;
        uniform float uHoverSnap;
        uniform float uHoverEnabled;
        uniform vec3 uAirplanePos;
        uniform float uAirplaneHoverEnabled;
        uniform float uAirplaneHoverRadius;
        // Radar pulse
        uniform float uRadarActive;
        uniform vec3 uRadarOrigin;
        uniform float uRadarRadius;
        uniform float uRadarRingWidth;
        uniform float uRadarFade;
        uniform float uRadarRainHeight;
        uniform float uRadarRainDuration;
        uniform float uRadarTime;
        uniform float uRadarExpandSpeed;
        uniform float uRadarRingFeather;
        uniform float uPersistentRevealRadius;
        uniform float uRainColorFadeDuration;
        uniform float uRainParticleLength;
        uniform float uRainImpactScale;
        uniform float uRainSpawnRadius;
        // hash-based 2D noise -> scalar in [-1,1]
        float hash(vec2 p){
          return -1.0 + 2.0 * fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        void main() {
          #include <uv_vertex>
          vec3 p = position;
          float h = 0.0;
          #ifdef USE_UV
          vec3 c = texture2D(uMap, vUv).rgb;
          h = (c.r + c.g + c.b) / 3.0;
          #endif
          // apply small XY jitter based on world position for seamless tiling
          if (uJitter > 0.0) {
            // Use world position for hash to ensure continuity across tile boundaries
            vec4 worldPosJitter = modelMatrix * vec4(p, 1.0);
            vec2 worldXZ = worldPosJitter.xz;
            float jx = hash(worldXZ + 0.123) * uJitter;
            float jz = hash(worldXZ + 4.567) * uJitter;
            p.x += jx;
            p.z += jz;
          }
          // base height
          float baseY = h * uScale + uBias;
          p.y = baseY;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = max(1.0, uPointSize * (300.0 / max(1.0, -mvPosition.z)));
          vec4 worldPos = modelMatrix * vec4(p, 1.0);
          float d = length((worldPos.xz - uMaskCenter) / vec2(uMaskAspect, 1.0));
          float edge0 = uMaskRadius;
          float edge1 = uMaskRadius + max(0.0001, uMaskFeather);
          vMaskAlpha = 1.0 - smoothstep(edge0, edge1, d);
          // mouse hover influence factor 0..1 with soft falloff
          float hd = length(worldPos.xz - uHoverCenter);
          float hEdge = uHoverRadius;
          vHoverMix = uHoverEnabled * (1.0 - smoothstep(hEdge, hEdge + 0.5, hd));
          // airplane hover - distance in XZ plane from airplane
          float airDist = length(worldPos.xz - uAirplanePos.xz);
          float airEdge = uAirplaneHoverRadius;
          vAirplaneMix = uAirplaneHoverEnabled * (1.0 - smoothstep(airEdge, airEdge + 0.8, airDist));
          // proximity factor: how close is the particle to airplane vertically (0=far, 1=close)
          // Use signed distance - particles ABOVE airplane are far (green), BELOW or at same level are close (red)
          float vertDist = uAirplanePos.y - worldPos.y; // positive when airplane is above particle
          vAirplaneProximity = 1.0 - clamp(vertDist / 0.6, 0.0, 1.0); // 0=airplane high above, 1=at or below particle
          
          // Radar pulse - expanding ring from origin with rain animation
          float radarDist = length(worldPos.xz - uRadarOrigin.xz);
          float innerEdge = uRadarRadius - uRadarRingWidth;
          float outerEdge = uRadarRadius + uRadarRingWidth;
          
          // Calculate when the radar ring reached this particle
          float ringArrivalTime = radarDist / max(0.1, uRadarExpandSpeed);
          float timeSinceArrival = uRadarTime - ringArrivalTime;
          
          // Default opacity and color blend (fully visible, final color when not in radar animation)
          vRadarRainOpacity = 1.0;
          vRainColorBlend = 1.0;
          vRainProgress = 1.0;
          vRainDirection = vec2(0.0, 1.0); // default: vertical on screen
          
          // Calculate screen-space "down" direction for rain dash orientation
          // Project world-space down vector to screen space
          vec4 worldPos4 = modelMatrix * vec4(p, 1.0);
          vec4 worldDown = worldPos4 + vec4(0.0, -1.0, 0.0, 0.0);
          vec4 clipPos = projectionMatrix * viewMatrix * worldPos4;
          vec4 clipDown = projectionMatrix * viewMatrix * worldDown;
          vec2 screenPos = clipPos.xy / clipPos.w;
          vec2 screenDown = clipDown.xy / clipDown.w;
          vec2 rainDir = normalize(screenDown - screenPos);
          // Only use this direction if it's valid (not degenerate)
          if (length(screenDown - screenPos) > 0.001) {
            vRainDirection = rainDir;
          }
          
          // Rain animation: apply to ALL particles reached by the radar pulse
          // Particles originate from near aircraft center and spread to final positions
          if (uRadarActive > 0.5 && timeSinceArrival > -0.1) {
            // Add slight randomized delay based on position for organic feel
            float randDelay = hash(vUv * 7.89) * 0.15;
            float delayedTime = timeSinceArrival - randDelay;
            float delayedProgress = clamp(delayedTime / max(0.01, uRadarRainDuration), 0.0, 1.0);
            // Easing: steady fall speed, then dramatic slowdown just before impact
            // Blend between linear (steady) and ease-out (slowing) based on progress
            float linear = delayedProgress;
            float easeOut = 1.0 - pow(1.0 - delayedProgress, 4.0);
            // Quadratic blend: more linear early, more ease-out near the end
            float blend = delayedProgress * delayedProgress;
            float delayedEased = mix(linear, easeOut, blend);
            float rainOffset = uRadarRainHeight * (1.0 - delayedEased);
            
            // Horizontal convergence: particles start near center and spread to final positions
            // Calculate direction from radar origin to particle's final position
            vec2 toParticle = worldPos.xz - uRadarOrigin.xz;
            float distFromOrigin = length(toParticle);
            vec2 dirFromOrigin = distFromOrigin > 0.01 ? toParticle / distFromOrigin : vec2(0.0);
            // At start (delayedEased=0), particles are at spawn radius from center
            // At end (delayedEased=1), particles are at their final position
            float startDist = uRainSpawnRadius;
            float horizontalOffset = mix(startDist, distFromOrigin, delayedEased) - distFromOrigin;
            vec2 horizontalShift = dirFromOrigin * horizontalOffset;
            
            // Opacity ramps from 0 to 1 as particles fall into place
            vRadarRainOpacity = delayedEased;
            
            // Pass LINEAR progress (not eased) for shape transition - this keeps dashes visible longer
            vRainProgress = delayedProgress;
            
            // Color crossfade: starts after landing, transitions over uRainColorFadeDuration
            // Time since particle landed (delayedEased reached 1.0)
            float landingTime = randDelay + uRadarRainDuration;
            float timeSinceLanding = max(0.0, delayedTime - uRadarRainDuration);
            float colorFadeProgress = clamp(timeSinceLanding / max(0.01, uRainColorFadeDuration), 0.0, 1.0);
            // 0 = rain color, 1 = ring/final color
            vRainColorBlend = colorFadeProgress;
            
            // Update world position for the rain effect (vertical + horizontal)
            worldPos.y += rainOffset;
            worldPos.x += horizontalShift.x;
            worldPos.z += horizontalShift.y;
            // Also update the gl_Position and point size
            vec3 animatedP = p;
            animatedP.y = baseY + rainOffset;
            animatedP.x += horizontalShift.x;
            animatedP.z += horizontalShift.y;
            mvPosition = modelViewMatrix * vec4(animatedP, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            // Two-phase size transition:
            // Phase 1 (0.7-0.9): shrink from rainScale to impactScale (visible impact)
            // Phase 2 (0.9-1.0): shrink from impactScale to 1.0 (settle to final size)
            float rainScale = uRainParticleLength * 4.0;
            float phase1 = smoothstep(0.7, 0.9, delayedProgress);
            float phase2 = smoothstep(0.9, 1.0, delayedProgress);
            float fallScale = mix(rainScale, uRainImpactScale, phase1);
            fallScale = mix(fallScale, 1.0, phase2);
            gl_PointSize = max(1.0, uPointSize * fallScale * (300.0 / max(1.0, -mvPosition.z)));
          }
          
          // Ring effect: particles within the ring band (with feathering)
          float feather = max(0.1, uRadarRingFeather);
          float ringMix = smoothstep(innerEdge - feather, innerEdge, radarDist) 
                        * (1.0 - smoothstep(outerEdge, outerEdge + feather, radarDist));
          // Persistent reveal uses the max of current radius and persistent radius
          // This ensures particles stay lit even when a new pulse starts
          float persistentEdge = max(outerEdge, uPersistentRevealRadius);
          float revealMix = 1.0 - smoothstep(persistentEdge - feather * 0.5, persistentEdge + feather, radarDist);
          vRadarMix = uRadarActive * max(ringMix * 1.5, revealMix * 0.8);
          // Height for coloring (normalized 0-1 based on final world Y, not animated)
          vRadarHeight = clamp((baseY + 1.0) / 3.0, 0.0, 1.0);
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform vec2 uViewportResolution;
        uniform vec2 uViewportRadius;
        uniform float uViewportFeather;
        uniform float uVignette;
        uniform vec3 uColor;
        uniform vec3 uHoverColor;
        uniform vec3 uAirplaneColorFar;
        uniform vec3 uAirplaneColorClose;
        uniform float uRadarFade;
        uniform float uRadarShowRing;
        uniform vec3 uRainColor;
        uniform vec3 uRadarRingColorLow;
        uniform vec3 uRadarRingColorMid;
        uniform vec3 uRadarRingColorHigh;
        uniform float uRainParticleWidth;
        uniform float uRainParticleLength;
        varying float vMaskAlpha;
        varying float vHoverMix;
        varying float vAirplaneMix;
        varying float vAirplaneProximity;
        varying float vRadarMix;
        varying float vRadarHeight;
        varying float vRadarRainOpacity;
        varying float vRainColorBlend;
        varying float vRainProgress;
        varying vec2 vRainDirection;
        #include <fog_pars_fragment>
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          float r = length(pc);
          
          // Rotate point coordinates to align dash with world-space "down" direction
          // This makes rain always appear to fall downward regardless of camera angle
          vec2 rainDir = normalize(vRainDirection);
          // Rotation matrix to align Y-axis with rain direction
          // rainDir points "down" in screen space, so we rotate pc to match
          vec2 rotatedPc;
          rotatedPc.x = pc.x * (-rainDir.y) + pc.y * (-rainDir.x);
          rotatedPc.y = pc.x * (-rainDir.x) + pc.y * (rainDir.y);
          
          // Disc shape (normal point) - uses unrotated coordinates
          float disc = 1.0 - smoothstep(0.45, 0.5, r);
          
          // Vertical line shape (rain streak) - uses rotated coordinates
          // Thickness is fully independent of length by compensating for point size scaling
          // Both the width and the edge softness are scaled inversely with length
          float lengthScale = max(1.0, uRainParticleLength);
          float compensation = 7.0 / lengthScale; // 7.0 is reference length
          float compensatedWidth = uRainParticleWidth * compensation;
          float edgeSoftness = 0.02 * compensation;
          float xMask = 1.0 - smoothstep(compensatedWidth, compensatedWidth + edgeSoftness, abs(rotatedPc.x));
          float yMask = 1.0 - smoothstep(0.48, 0.5, abs(rotatedPc.y));
          float lineMask = xMask * yMask;
          
          // Shape transition: starts during impact phase (0.88) for visible impact effect
          // The impact size parameter controls how large the circle is at transition
          float shapeBlend = smoothstep(0.88, 0.98, vRainProgress);
          float shape = mix(lineMask, disc, shapeBlend);
          
          // Radar can reveal particles beyond the mask
          float radarAlpha = vRadarMix * uRadarFade;
          float effectiveAlpha = max(vMaskAlpha, radarAlpha);
          
          // Rain opacity: start more visible (0.6) and ramp to full
          // This ensures lines are visible during the fall
          float rainAlpha = mix(0.6, 1.0, vRadarRainOpacity);
          vec2 screenUV = gl_FragCoord.xy / uViewportResolution - 0.5;
          float ovalDistance = length(screenUV / uViewportRadius);
          float ovalAlpha = 1.0 - smoothstep(1.0 - uViewportFeather, 1.0, ovalDistance);
          float alpha = shape * effectiveAlpha * rainAlpha * ovalAlpha;
          if (alpha <= 0.001) discard;
          
          // Start with base color
          vec3 col = uColor;
          // Apply mouse hover color
          col = mix(col, uHoverColor, vHoverMix);
          // Apply airplane hover - blend between far (orange) and close (red) based on proximity
          vec3 airplaneColor = mix(uAirplaneColorFar, uAirplaneColorClose, vAirplaneProximity);
          col = mix(col, airplaneColor, vAirplaneMix);
          
          // Rain color - applied to falling particles, crossfades to ring/base color
          // vRainColorBlend: 0 = rain color, 1 = final color
          if (vRainColorBlend < 1.0) {
            // Calculate the target color (ring color if enabled, otherwise base)
            vec3 targetColor = col;
            if (uRadarShowRing > 0.5) {
              targetColor = vRadarHeight < 0.5 
                ? mix(uRadarRingColorLow, uRadarRingColorMid, vRadarHeight * 2.0)
                : mix(uRadarRingColorMid, uRadarRingColorHigh, (vRadarHeight - 0.5) * 2.0);
            }
            // Crossfade from rain color to target color
            col = mix(uRainColor, targetColor, vRainColorBlend);
          } else if (uRadarShowRing > 0.5) {
            // Fully transitioned, apply ring color if enabled
            vec3 radarColor = vRadarHeight < 0.5 
              ? mix(uRadarRingColorLow, uRadarRingColorMid, vRadarHeight * 2.0)
              : mix(uRadarRingColorMid, uRadarRingColorHigh, (vRadarHeight - 0.5) * 2.0);
            col = mix(col, radarColor, radarAlpha * 0.9);
          }
          
          col *= 1.0 - uVignette * smoothstep(0.15, 1.0, ovalDistance);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }
      `
    });
    // Enable UV chunks in shader includes
    pointMaterial.defines = pointMaterial.defines || {};
    pointMaterial.defines.USE_UV = '';
    

    // (Trail system removed)

    // ========== AIRPLANE ==========
    let airplane = null;
    let airplaneGroup = null;
    const airplaneState = {
      enabled: false,
      x: 0,          // current X position (world space offset from center)
      targetX: 0,    // target X position
      y: 0,          // current Y offset (altitude adjustment)
      targetY: 0,    // target Y offset
      tilt: 0,       // current tilt (roll) angle
      pitch: 0,      // current pitch angle
      speed: 3,      // horizontal movement speed
      vertSpeed: 2,  // vertical movement speed
      maxOffset: 5.5,  // max left/right offset
      altitudeRange: 4.6, // max up/down range
      smoothing: 8,  // lerp smoothing factor
      height: -2.5,  // height offset from camera
      size: 0.4,     // scale of the airplane
      distance: 3.5, // distance ahead of camera
      // Chase cam world position (used when chase cam is on)
      worldPos: new THREE.Vector3(0, 1.5, 0),
      baseAltitude: 1.5, // base flying altitude in chase cam mode
      // Collision state
      isColliding: false,
      collisionShake: 0,
      collisionThreshold: -0.1, // negative = only trigger when actually below terrain
      // Free roam heading/turning
      heading: 0,           // current yaw angle (radians) - 0 = facing -Z
      targetHeading: 0,     // smoothed heading target
      turnSpeed: 1.5,       // radians per second turn rate
      // Strafe
      strafeOffset: 0,      // current strafe offset (perpendicular to heading)
      targetStrafeOffset: 0, // target strafe for easing
      strafeSpeed: 1.0,     // strafe speed in units per second (slow)
      strafeEasing: 2.0,    // easing factor (lower = heavier ease-in)
      maxStrafe: 8.0,       // maximum strafe distance from center
    };
    
    // Store airplane materials for color change on collision
    let airplaneMaterials = [];
    const keysPressed = { throttleUp: false, throttleDown: false, strafeLeft: false, strafeRight: false };
    
    // Mouse control state for airplane direction
    const mouseControl = {
      turnRate: 0,           // continuous turn rate from mouse X (-1 to 1)
      climbRate: 0,          // continuous climb rate from mouse Y (-1 to 1)
      active: false          // whether mouse is over canvas
    };
    
    // Radar pulse state
    const radarState = {
      active: false,
      startTime: 0,
      fadeEndTime: 0,         // absolute time when effect should fully fade (can be extended)
      expandDuration: 3.6,    // seconds to expand to full radius
      persistDuration: 2.0,   // seconds to persist after expansion
      fadeDuration: 0.5,      // seconds to fade out
      maxRadius: 35.0,        // max expansion radius
      expandSpeed: 9.72,      // units per second (maxRadius / expandDuration)
      currentRadius: 0,       // current animated radius (doesn't reset on re-pulse)
      rainHeight: 41.0,       // how high particles start above their final position
      rainDuration: 0.5,      // how long the fall animation takes
      rainSpawnRadius: 0.5,   // how close to aircraft center particles originate
      showRing: false,        // whether to show the colored pulse ring
      ringFeather: 0.1,       // softness of the ring edges
      rainColor: '#bff4ff',   // color of falling particles
      ringColorLow: '#00ccff',  // ring color for valleys
      ringColorMid: '#00ff80',  // ring color for mid heights
      ringColorHigh: '#ffee33', // ring color for peaks
      colorFadeDuration: 1.0,   // time to crossfade from rain to ring color
      // Visual ring settings
      visualRingEnabled: true,
      visualRingColor: '#ffa500',
      visualRingWidth: 0.07,
      visualRingOpacity: 1.0,
      // Rain particle shape
      rainParticleWidth: 0.01,
      rainParticleLength: 7.0,
      rainImpactScale: 4.5,
      // Persistent reveal tracking
      persistentRevealRadius: 0.0
    };
    
    // Multiple visual expanding rings - each pulse creates a new ring
    const visualRings = [];
    const MAX_VISUAL_RINGS = 10; // Pool size
    
    function createVisualRingMesh() {
      const geometry = new THREE.RingGeometry(0.1, 0.2, 128);
      geometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane
      
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(radarState.visualRingColor) },
          uOpacity: { value: radarState.visualRingOpacity },
          uInnerRadius: { value: 0.1 },
          uOuterRadius: { value: 0.2 },
          uFeather: { value: 0.05 }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vLocalPos;
          void main() {
            vUv = uv;
            vLocalPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uInnerRadius;
          uniform float uOuterRadius;
          uniform float uFeather;
          varying vec2 vUv;
          varying vec3 vLocalPos;
          void main() {
            float dist = length(vLocalPos.xz);
            float innerAlpha = smoothstep(uInnerRadius - uFeather, uInnerRadius + uFeather, dist);
            float outerAlpha = 1.0 - smoothstep(uOuterRadius - uFeather, uOuterRadius + uFeather, dist);
            float alpha = innerAlpha * outerAlpha * uOpacity;
            float edgeDist = min(dist - uInnerRadius, uOuterRadius - dist);
            float edgeGlow = 1.0 + 0.5 * (1.0 - smoothstep(0.0, uFeather * 2.0, edgeDist));
            gl_FragColor = vec4(uColor * edgeGlow, alpha);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 999;
      scene.add(mesh);
      return mesh;
    }
    
    // Active ring instances with their own animation state
    const activeRings = [];
    
    function spawnVisualRing(origin) {
      if (!radarState.visualRingEnabled) return;
      
      // Get or create a ring mesh
      let ring;
      if (visualRings.length < MAX_VISUAL_RINGS) {
        ring = createVisualRingMesh();
        visualRings.push(ring);
      } else {
        // Find an inactive ring to reuse
        ring = visualRings.find(r => !r.visible);
        if (!ring) {
          // All rings in use, reuse the oldest active one
          const oldest = activeRings.shift();
          if (oldest) {
            oldest.mesh.visible = false;
            ring = oldest.mesh;
          } else {
            return; // No available rings
          }
        }
      }
      
      ring.position.set(origin.x, origin.y, origin.z);
      ring.visible = true;
      
      activeRings.push({
        mesh: ring,
        startTime: performance.now() * 0.001,
        origin: origin.clone()
      });
    }
    
    function updateVisualRings() {
      const now = performance.now() * 0.001;
      const totalDuration = radarState.expandDuration + radarState.persistDuration + radarState.fadeDuration;
      
      for (let i = activeRings.length - 1; i >= 0; i--) {
        const ringData = activeRings[i];
        const elapsed = now - ringData.startTime;
        
        if (elapsed >= totalDuration) {
          // Ring is done, hide it
          ringData.mesh.visible = false;
          activeRings.splice(i, 1);
          continue;
        }
        
        // Calculate radius and fade for this ring
        let currentRadius, currentFade;
        
        if (elapsed < radarState.expandDuration) {
          const progress = elapsed / radarState.expandDuration;
          currentRadius = progress * radarState.maxRadius;
          currentFade = 1.0;
        } else if (elapsed < radarState.expandDuration + radarState.persistDuration) {
          currentRadius = radarState.maxRadius;
          currentFade = 1.0;
        } else {
          const fadeProgress = (elapsed - radarState.expandDuration - radarState.persistDuration) / radarState.fadeDuration;
          currentRadius = radarState.maxRadius;
          currentFade = 1.0 - fadeProgress;
        }
        
        // Update ring geometry and material
        const width = radarState.visualRingWidth;
        const innerRadius = Math.max(0.01, currentRadius - width);
        const outerRadius = currentRadius + width;
        
        ringData.mesh.geometry.dispose();
        ringData.mesh.geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128);
        ringData.mesh.geometry.rotateX(-Math.PI / 2);
        
        const mat = ringData.mesh.material;
        mat.uniforms.uInnerRadius.value = innerRadius;
        mat.uniforms.uOuterRadius.value = outerRadius;
        mat.uniforms.uOpacity.value = radarState.visualRingOpacity * currentFade;
        mat.uniforms.uColor.value.set(radarState.visualRingColor);
        mat.uniforms.uFeather.value = width * 0.3;
      }
    }

    function createAirplane() {
      // Create a retro wireframe arrow pointing forward
      const group = new THREE.Group();
      
      // Arrow outline - wireframe style like retro arcade radar
      // Arrow points forward (+Z direction after 180 flip)
      const arrowVerts = new Float32Array([
        // Arrow shape pointing forward (nose at front)
        0, 0, 0.5,        // nose (front tip)
        -0.25, 0, -0.3,   // left back corner
        0, 0, -0.15,      // center notch (back)
        
        0, 0, 0.5,        // nose (front tip)
        0, 0, -0.15,      // center notch (back)
        0.25, 0, -0.3,    // right back corner
        
        // Close the back
        -0.25, 0, -0.3,   // left back corner
        0, 0, -0.15,      // center notch
        0.25, 0, -0.3,    // right back corner
      ]);
      
      const arrowGeo = new THREE.BufferGeometry();
      arrowGeo.setAttribute('position', new THREE.BufferAttribute(arrowVerts, 3));
      
      // Wireframe material - retro arcade look
      const wireMat = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.9
      });
      
      const arrow = new THREE.Mesh(arrowGeo, wireMat);
      group.add(arrow);
      
      // Store materials for collision color change
      airplaneMaterials = [wireMat];
      
      // Add edge lines for cleaner wireframe look
      const edgeVerts = new Float32Array([
        // Outline of the arrow
        0, 0, 0.5,        // nose
        -0.25, 0, -0.3,   // left back
        -0.25, 0, -0.3,   // left back
        0, 0, -0.15,      // center notch
        0, 0, -0.15,      // center notch
        0.25, 0, -0.3,    // right back
        0.25, 0, -0.3,    // right back
        0, 0, 0.5,        // back to nose
      ]);
      
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
      
      const lineMat = new THREE.LineBasicMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        linewidth: 2
      });
      
      const edges = new THREE.LineSegments(edgeGeo, lineMat);
      group.add(edges);
      
      // Add line material to stored materials
      airplaneMaterials.push(lineMat);
      
      // Scale based on airplaneState.size
      group.scale.set(airplaneState.size, airplaneState.size, airplaneState.size);
      
      return group;
    }

    function initAirplane() {
      if (airplaneGroup) {
        scene.remove(airplaneGroup);
        airplaneGroup = null;
      }
      airplaneGroup = createAirplane();
      airplaneGroup.visible = airplaneState.enabled;
      scene.add(airplaneGroup);
    }

    function updateAirplane(delta) {
      if (!airplaneGroup || !airplaneState.enabled) return;
      
      const isChaseMode = params.cameraMode === 'chase';
      const isTopdownMode = params.cameraMode === 'topdown';
      const isIsoMode = params.cameraMode === 'isometric';
      
      // Handle throttle input - W/S control speed
      const throttleSpeed = 3.0; // speed change per second
      const maxSpeed = 10.0;
      const minSpeed = 0.0;
      
      if (keysPressed.throttleUp) {
        state.scrollSpeed = Math.min(maxSpeed, state.scrollSpeed + throttleSpeed * delta);
        params.scrollSpeed = state.scrollSpeed;
      }
      if (keysPressed.throttleDown) {
        state.scrollSpeed = Math.max(minSpeed, state.scrollSpeed - throttleSpeed * delta);
        params.scrollSpeed = state.scrollSpeed;
      }
      
      // Handle strafe input - A/D control lateral movement with heavy easing
      if (keysPressed.strafeLeft) {
        airplaneState.targetStrafeOffset = Math.max(-airplaneState.maxStrafe, 
          airplaneState.targetStrafeOffset - airplaneState.strafeSpeed * delta);
      }
      if (keysPressed.strafeRight) {
        airplaneState.targetStrafeOffset = Math.min(airplaneState.maxStrafe, 
          airplaneState.targetStrafeOffset + airplaneState.strafeSpeed * delta);
      }
      // Ease strafe offset toward target (heavy ease-in)
      const strafeDiff = airplaneState.targetStrafeOffset - airplaneState.strafeOffset;
      airplaneState.strafeOffset += strafeDiff * Math.min(1, airplaneState.strafeEasing * delta);
      
      // Mouse controls heading and altitude as continuous rates
      if (mouseControl.active) {
        // Turn rate: mouse X position determines how fast we turn
        // At speed 0, allow slower rotation in place to reposition direction
        const baseTurnSpeed = 1.5; // radians per second at full deflection
        const turnSpeed = state.scrollSpeed > 0 ? baseTurnSpeed : baseTurnSpeed * 0.5; // slower rotation when stationary
        airplaneState.heading += mouseControl.turnRate * turnSpeed * delta;
        
        // Climb rate: slower when stationary for precise positioning
        const baseClimbSpeed = 3.0; // units per second at full deflection
        const climbSpeed = state.scrollSpeed > 0 ? baseClimbSpeed : baseClimbSpeed * 0.3; // slower when stationary
        airplaneState.targetY += mouseControl.climbRate * climbSpeed * delta;
        airplaneState.targetY = Math.max(-airplaneState.altitudeRange, 
                                Math.min(airplaneState.altitudeRange, airplaneState.targetY));
      }
      
      // Smooth vertical movement toward target
      const dy = airplaneState.targetY - airplaneState.y;
      airplaneState.y += dy * Math.min(1, airplaneState.smoothing * delta);
      
      // Calculate tilt based on turning (bank into turns like real airplane)
      // Subtle tilt when rotating in place, full tilt when flying
      const tiltAmount = state.scrollSpeed > 0 ? 0.5 : 0.15; // less tilt when stationary
      const targetTilt = mouseControl.turnRate * tiltAmount;
      airplaneState.tilt += (targetTilt - airplaneState.tilt) * Math.min(1, 6 * delta);
      
      // Calculate pitch based on vertical movement
      const targetPitch = dy * 0.8; // nose up when climbing, down when diving
      airplaneState.pitch += (targetPitch - airplaneState.pitch) * Math.min(1, 6 * delta);
      
      // Get forward direction based on heading (heading 0 = -Z direction)
      const forward = new THREE.Vector3(
        Math.sin(airplaneState.heading),
        0,
        -Math.cos(airplaneState.heading)
      );
      
      // Get right vector
      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      
      if (isChaseMode || isTopdownMode || isIsoMode) {
        // Free roam mode: airplane stays at origin, faces heading direction
        // Terrain scrolls based on heading and speed
        // Strafe offset is perpendicular to heading
        const strafeX = Math.cos(airplaneState.heading) * airplaneState.strafeOffset;
        const strafeZ = Math.sin(airplaneState.heading) * airplaneState.strafeOffset;
        
        airplaneState.worldPos.x = strafeX;
        airplaneState.worldPos.y = airplaneState.baseAltitude + airplaneState.y;
        airplaneState.worldPos.z = strafeZ;
        
        // Set airplane position from world pos
        airplaneGroup.position.copy(airplaneState.worldPos);
      } else {
        // Normal mode: airplane positioned relative to camera
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        camForward.y = 0;
        if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
        camForward.normalize();
        
        const camRight = new THREE.Vector3();
        camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
        
        airplaneGroup.position.copy(camera.position);
        airplaneGroup.position.addScaledVector(camForward, airplaneState.distance);
        airplaneGroup.position.y = camera.position.y + airplaneState.height + airplaneState.y;
      }
      
      // Update scale
      airplaneGroup.scale.set(airplaneState.size, airplaneState.size, airplaneState.size);
      
      // Orient airplane to face heading direction with tilt and pitch
      const lookTarget = airplaneGroup.position.clone().add(forward);
      airplaneGroup.lookAt(lookTarget);
      airplaneGroup.rotation.z = airplaneState.tilt;
      airplaneGroup.rotation.x += airplaneState.pitch;
      
      const time = performance.now() * 0.001;
      
      // Collision detection - sample actual terrain height at airplane position
      const terrainHeight = sampleTerrainHeight(airplaneGroup.position.x, airplaneGroup.position.z);
      
      const wasColliding = airplaneState.isColliding;
      if (terrainHeight !== null) {
        // Compare airplane Y to actual terrain height at this position
        const clearance = airplaneGroup.position.y - terrainHeight;
        airplaneState.isColliding = clearance < airplaneState.collisionThreshold;
      } else {
        airplaneState.isColliding = false; // No heightmap yet
      }
      
      // Handle collision effects
      // Get target colors from uniforms (which are synced with params)
      const dangerColor = pointMaterial.uniforms.uAirplaneColorClose.value;
      const safeColor = pointMaterial.uniforms.uAirplaneColorFar.value;
      
      if (airplaneState.isColliding) {
        // Increase shake intensity
        airplaneState.collisionShake = Math.min(airplaneState.collisionShake + delta * 15, 1.0);
        
        // Turn airplane to danger color
        for (const mat of airplaneMaterials) {
          mat.color.copy(dangerColor);
        }
        
        // Apply shake
        const shakeIntensity = airplaneState.collisionShake * 0.08;
        airplaneGroup.position.x += (Math.random() - 0.5) * shakeIntensity;
        airplaneGroup.position.y += (Math.random() - 0.5) * shakeIntensity;
        airplaneGroup.position.z += (Math.random() - 0.5) * shakeIntensity;
        airplaneGroup.rotation.z += (Math.random() - 0.5) * shakeIntensity * 0.5;
      } else {
        // Decay shake when not colliding
        airplaneState.collisionShake = Math.max(airplaneState.collisionShake - delta * 5, 0);
        
        // Transition to safe color smoothly
        for (const mat of airplaneMaterials) {
          const currentColor = mat.color;
          currentColor.r += (safeColor.r - currentColor.r) * delta * 5;
          currentColor.g += (safeColor.g - currentColor.g) * delta * 5;
          currentColor.b += (safeColor.b - currentColor.b) * delta * 5;
        }
        
        // Add subtle bobbing motion only when not colliding
        airplaneGroup.position.y += Math.sin(time * 2) * 0.02;
      }
    }

    // Keyboard controls for airplane - W/S for throttle, A/D for strafe
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('button,input,select,textarea,#panel-container')) return;
      // Prevent spacebar from scrolling page
      if (e.code === 'Space') {
        e.preventDefault();
      }
      if (!airplaneState.enabled) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        keysPressed.throttleUp = true;
        e.preventDefault();
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keysPressed.throttleDown = true;
        e.preventDefault();
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keysPressed.strafeLeft = true;
        e.preventDefault();
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keysPressed.strafeRight = true;
        e.preventDefault();
      }
    });

    window.addEventListener('blur', () => { Object.keys(keysPressed).forEach(key=>keysPressed[key]=false); cameraOrbit.isDragging=false; mouseControl.active=false; });
    window.addEventListener('keyup', (e) => {
      if (e.target.closest?.('button,input,select,textarea,#panel-container')) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        keysPressed.throttleUp = false;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        keysPressed.throttleDown = false;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keysPressed.strafeLeft = false;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keysPressed.strafeRight = false;
      }
      // G key cycles camera modes
      if (e.code === 'KeyG' && airplaneState.enabled) {
        cycleCameraMode();
      }
      // Spacebar triggers radar pulse
      if (e.code === 'Space') {
        triggerRadarPulse();
        e.preventDefault();
      }
    });
    
    function triggerRadarPulse() {
      // Only allow radar pulse when airplane is enabled
      if (!airplaneState.enabled) return;
      
      // Get origin from airplane position
      const origin = airplaneState.worldPos.clone();
      
      // Always spawn a new visual ring (multiple rings supported)
      spawnVisualRing(origin);
      
      const now = performance.now() * 0.001;
      radarState.expandSpeed = radarState.maxRadius / radarState.expandDuration;
      const totalDuration = radarState.expandDuration + radarState.persistDuration + radarState.fadeDuration;
      
      if (radarState.active) {
        // ADDITIVE: Already active - extend the timer, don't reset animation
        // Extend fade end time from now
        radarState.fadeEndTime = now + radarState.persistDuration + radarState.fadeDuration;
        // Keep fade at 1.0 (refresh the timer)
        pointMaterial.uniforms.uRadarFade.value = 1.0;
        // DON'T reset: startTime, uRadarTime, uRadarRadius, currentRadius
        // The ring continues expanding from where it was
      } else {
        // Fresh start - no active pulse
        radarState.active = true;
        radarState.startTime = now;
        radarState.fadeEndTime = now + totalDuration;
        radarState.currentRadius = 0;
        
        pointMaterial.uniforms.uRadarRadius.value = 0.0;
        pointMaterial.uniforms.uRadarFade.value = 1.0;
        pointMaterial.uniforms.uRadarTime.value = 0.0;
        pointMaterial.uniforms.uRadarOrigin.value.copy(origin);
      }
      
      pointMaterial.uniforms.uRadarActive.value = 1.0;
      pointMaterial.uniforms.uRadarRainHeight.value = radarState.rainHeight;
      pointMaterial.uniforms.uRadarRainDuration.value = radarState.rainDuration;
      pointMaterial.uniforms.uRainSpawnRadius.value = radarState.rainSpawnRadius;
      pointMaterial.uniforms.uRadarExpandSpeed.value = radarState.expandSpeed;
      pointMaterial.uniforms.uRadarShowRing.value = radarState.showRing ? 1.0 : 0.0;
      pointMaterial.uniforms.uRadarRingFeather.value = radarState.ringFeather;
      pointMaterial.uniforms.uRainColor.value.set(radarState.rainColor);
      pointMaterial.uniforms.uRadarRingColorLow.value.set(radarState.ringColorLow);
      pointMaterial.uniforms.uRadarRingColorMid.value.set(radarState.ringColorMid);
      pointMaterial.uniforms.uRadarRingColorHigh.value.set(radarState.ringColorHigh);
      pointMaterial.uniforms.uRainColorFadeDuration.value = radarState.colorFadeDuration;
      pointMaterial.uniforms.uRainParticleWidth.value = radarState.rainParticleWidth;
      pointMaterial.uniforms.uRainParticleLength.value = radarState.rainParticleLength;
      pointMaterial.uniforms.uRainImpactScale.value = radarState.rainImpactScale;
    }
    
    function cycleCameraMode() {
      const modes = ['landscape', 'chase', 'topdown', 'isometric'];
      const currentIndex = modes.indexOf(params.cameraMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      setCameraMode(modes[nextIndex]);
    }
    
    function setCameraMode(mode) {
      params.cameraMode = mode;
      if (mode === 'landscape' || !airplaneState.enabled) {
        camera.position.set(0,params.camHeight,params.camZ);
        applyYawPitchDeg(params.camYaw,params.camPitch);
      }
      
      // Reset airplane state when switching modes (if airplane is enabled)
      airplaneState.heading = 0;
      airplaneState.targetHeading = 0;
      airplaneState.y = 0;
      airplaneState.targetY = 0;
      airplaneState.tilt = 0;
      airplaneState.pitch = 0;
      airplaneState.worldPos.set(0, airplaneState.baseAltitude, 0);
      // Reset camera orbit when switching modes
      cameraOrbit.azimuth = 0;
      cameraOrbit.elevation = 0;
      
      pane.refresh();
    }

    // Construct the optional aircraft only when it is enabled.

    // Tiling with Points
    let tilesPoints = [];
    const state = { tileSize: 44, tilesX: 5, tilesZ: 4, scrollSpeed: 3.0 };
    const scrollOffset = new THREE.Vector2(0, 0);

    function buildBaseGeometry() {
      const g = new THREE.PlaneGeometry(state.tileSize, state.tileSize, params.cols, params.rows);
      g.rotateX(-Math.PI / 2);
      return g;
    }

    function positiveModulo(v, m) { return ((v % m) + m) % m; }

    function updateTileMatrices() {
      if (!tilesPoints || tilesPoints.length === 0) return;
      let idx = 0;
      const offsetX = (state.tilesX - 1) * state.tileSize * 0.5;
      const offsetZ = (state.tilesZ - 1) * state.tileSize * 0.5;
      const modX = positiveModulo(scrollOffset.x, state.tileSize);
      const modZ = positiveModulo(scrollOffset.y, state.tileSize);
      for (let z = 0; z < state.tilesZ; z++) {
        for (let x = 0; x < state.tilesX; x++) {
          const px = (x * state.tileSize) - offsetX - modX;
          const pz = (z * state.tileSize) - offsetZ - modZ;
          const pts = tilesPoints[idx++];
          if (pts) pts.position.set(px, 0, pz);
        }
      }
    }

    let rebuildTimer;
    function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildTiling, 150); }
    function rebuildTiling() {
      const oldGeometries = new Set(tilesPoints.map(p=>p.geometry));
      for (const p of tilesPoints) scene.remove(p);
      for (const geometry of oldGeometries) geometry.dispose();
      tilesPoints = [];
      const geometry = buildBaseGeometry();
      geometry.deleteAttribute('normal');
      geometry.deleteAttribute('tangent');
      // Draw each grid vertex once; triangle expansion duplicates points six times.
      geometry.setIndex(null);
      const nonIndexed = geometry;
      nonIndexed.computeBoundingSphere();
      for (let z = 0; z < state.tilesZ; z++) {
        for (let x = 0; x < state.tilesX; x++) {
          const pts = new THREE.Points(nonIndexed, pointMaterial);
          pts.frustumCulled = false;
          tilesPoints.push(pts);
          scene.add(pts);
        }
      }
      updateTileMatrices();
    }

    // Build particles after the initial heightmap has loaded.

    // (Car and follower removed)

    // (CPU height sampling removed)

    // (Cursor/mouse following removed)

    // UI elements
    const fileInput = document.getElementById('heightmapFile');

    // Tweakpane setup
    const panelContainer = document.getElementById('panel-container');
    const pane = new window.SHPanel(panelContainer);
    const bindings = [];
    function bind(folder, object, key, options = {}) {
      const type = options.options ? 'select' : options.view === 'color' ? 'color' : typeof object[key] === 'boolean' ? 'toggle' : 'slider';
      const control = folder[type](object, key, options);
      const record = { object, key, control, initial: object[key], change: null };
      bindings.push(record);
      const on = control.on.bind(control);
      control.on = (event, fn) => { if (event === 'change') record.change = fn; return on(event, fn); };
      return control;
    }
    pane.refresh = () => bindings.forEach(({object,key,control}) => control.setValue(object[key]));
    document.querySelector('.sh-panel-hint')?.remove();
    const panelToggle = document.getElementById('panel-toggle');
    const syncPanelToggle = () => {
      const closed = panelContainer.classList.contains('collapsed');
      panelToggle.textContent = closed ? 'Show controls' : 'Hide controls';
      panelToggle.setAttribute('aria-expanded', String(!closed));
      panelContainer.inert = closed;
    };
    panelToggle.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', {code:'Backquote', bubbles:true})));
    window.addEventListener('sh-panel-toggle', syncPanelToggle);
    syncPanelToggle();
    for (const event of ['pointerdown','pointermove','mousedown','mousemove','wheel','keydown','keyup']) {
      panelContainer.addEventListener(event, e => { if(e.code !== 'Backquote') e.stopPropagation(); });
    }
    panelContainer.addEventListener('focusin', () => {
      Object.keys(keysPressed).forEach(key => keysPressed[key] = false);
      mouseControl.active = false;
      cameraOrbit.isDragging = false;
    });
    const status = document.createElement('p');
    status.className = 'panel-status'; status.setAttribute('role','status');
    pane._body.append(status);
    const setStatus = message => { status.textContent = message; };
    pane.button('Copy JSON', async () => {
      const settings = { ...params, radar: {} };
      for (const b of bindings) {
        if (b.object === radarState) settings.radar[b.key] = b.object[b.key];
      }
      settings.radar.ringWidth = pointMaterial.uniforms.uRadarRingWidth.value;
      settings.heightmap = activeHeightmap;
      const json = JSON.stringify({project:'particle-landscape',version:1,settings}, null, 2);
      try {
        try { await navigator.clipboard.writeText(json); }
        catch {
          const input = document.createElement('textarea'); input.value = json;
          panelContainer.append(input); input.select();
          const copied = document.execCommand('copy'); input.remove();
          if (!copied) throw new Error('Clipboard unavailable');
        }
        setStatus('JSON copied');
      } catch { setStatus('Could not copy. Please allow clipboard access and try again.'); }
    });
    pane.button('Reset all', () => {
      for (const b of bindings) b.object[b.key] = b.initial;
      for (const b of bindings) b.change?.({value:b.object[b.key]});
      scrollOffset.set(0,0); cameraOrbit.azimuth=0; cameraOrbit.elevation=0;
      Object.assign(airplaneState, {heading:0,targetHeading:0,y:0,targetY:0,tilt:0,pitch:0,strafeOffset:0,targetStrafeOffset:0});
      Object.keys(keysPressed).forEach(key => keysPressed[key] = false);
      radarState.active = false; radarState.persistentRevealRadius=0; visualRings.forEach(ring=>ring.visible=false);
      pointMaterial.uniforms.uPersistentRevealRadius.value = 0;
      pointMaterial.uniforms.uMaskCenter.value.set(0,0);
      camera.position.set(0,params.camHeight,params.camZ);
      applyYawPitchDeg(params.camYaw,params.camPitch);
      pane.refresh(); scheduleRebuild();
      activeHeightmap = DEFAULT_HEIGHTMAP_URL;
      new THREE.TextureLoader().load(DEFAULT_HEIGHTMAP_URL, tex => applyHeightmapTexture(tex).catch(() => setStatus('Could not reset heightmap.')));
      setStatus('Defaults restored');
    });
    
    // Parameters object
    const params = {
      // Heightmap
      terrainColor: '#b1b5be',
      scale: 8.0,
      tileSize: 44,
      tilesX: 5,
      tilesZ: 4,
      // Particles
      pointSize: 0.16,
      jitter: 0.02,
      hoverRadius: 1.6,
      hoverStrength: 0.8,
      hoverSnap: 2.0,
      hoverColor: '#ffcc55',
      cols: 200,
      rows: 200,
      // Mask
      maskRadius: 8.8,
      maskFeather: 4.9,
      maskAspect: 1.5,
      viewportWidth: 0.49,
      viewportHeight: 0.43,
      viewportFeather: 0.5,
      vignette: 0.18,
      // Animation
      scrollSpeed: 3.0,
      animateScroll: true,
      // Camera
      camYaw: 0,
      camPitch: -37,
      camFov: 65,
      camHeight: 9.0,
      camZ: 12.0,
      // Fog
      fogEnabled: true,
      fogColor: '#0e0f13',
      fogStart: 1,
      fogEnd: 34,
      // Camera modes: 'chase', 'topdown', 'isometric'
      cameraMode: 'landscape',
      chaseCamDistance: 3.3,
      chaseCamHeight: 0.8,
      chaseCamAltitude: 1.5,
      topCamHeight: 7.0,
      isoCamDistance: 2.0,
      isoCamHeight: 4.0,
      // Airplane
      airplaneEnabled: false,
      airplaneAltitudeRange: 4.6,
      airplaneHeight: -2.5,
      airplaneSize: 0.4,
      airplaneDistance: 3.5,
      // Hover highlights
      mouseHoverEnabled: true,
      airplaneHoverEnabled: false,
      airplaneHoverRadius: 0.5,
      airplaneColorSafe: '#ff9000',   // orange when high/safe
      airplaneColorDanger: '#ff0000', // red when low/danger
      // Strafe settings
      strafeSpeed: 1.0,
      strafeEasing: 2.0,
      maxStrafe: 8.0,
    };

    // Helper functions
    const degToRad = (d) => d * Math.PI / 180;
    const clampPitchDeg = (p) => Math.max(-89, Math.min(89, p));
    function applyYawPitchDeg(yawDeg, pitchDeg) {
      const yaw = degToRad(yawDeg);
      const pitch = degToRad(clampPitchDeg(pitchDeg));
      const e = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(e);
    }

    function clampPowerOfTwo(n) {
      return Math.max(2, Math.min(2048, Math.floor(n)));
    }

    function applyFogFromParams() {
      scene.background = new THREE.Color(params.fogColor);
      if (params.fogEnabled) {
        scene.fog = new THREE.Fog(
          params.fogColor, 
          params.fogStart,
          params.fogEnd
        );

      } else {
        scene.fog = null;
      }
    }

    // Heightmap folder
    const heightmapFolder = pane.folder('Landscape', { expanded: false });
    heightmapFolder.button('Load Heightmap...').on('click', () => {
      fileInput.click();
    });
    bind(heightmapFolder, params, 'terrainColor', { view: 'color' }).on('change', (ev) => {
      pointMaterial.uniforms.uColor.value.set(ev.value);
    });
    bind(heightmapFolder, params, 'scale', { min: 0, max: 8, step: 0.1 }).on('change', (ev) => {
      pointMaterial.uniforms.uScale.value = ev.value;
      pointMaterial.uniforms.uBias.value = -ev.value * 0.5;
    });
    bind(heightmapFolder, params, 'tileSize', { min: 2, max: 50, step: 1 }).on('change', (ev) => {
      state.tileSize = Math.max(1, ev.value);
      scrollOffset.set(0, 0); // Reset scroll to center tiles
      scheduleRebuild();
    });
    bind(heightmapFolder, params, 'tilesX', { min: 1, max: 5, step: 1 }).on('change', (ev) => {
      state.tilesX = Math.max(1, Math.min(20, ev.value));
      scrollOffset.set(0, 0); // Reset scroll to center tiles
      scheduleRebuild();
    });
    bind(heightmapFolder, params, 'tilesZ', { min: 1, max: 5, step: 1 }).on('change', (ev) => {
      state.tilesZ = Math.max(1, Math.min(20, ev.value));
      scrollOffset.set(0, 0); // Reset scroll to center tiles
      scheduleRebuild();
    });

    // Particles folder
    const particlesFolder = pane.folder('Particles & hover', { expanded: true });
    bind(particlesFolder, params, 'pointSize', { min: 0, max: 1.0, step: 0.01, label: 'Point Size' }).on('change', (ev) => {
      pointMaterial.uniforms.uPointSize.value = ev.value;
    });
    bind(particlesFolder, params, 'jitter', { min: 0.0, max: 0.2, step: 0.001 }).on('change', (ev) => {
      pointMaterial.uniforms.uJitter.value = ev.value;
    });
    bind(particlesFolder, params, 'hoverRadius', { min: 0.1, max: 10, step: 0.1, label: 'Hover Radius' }).on('change', (ev) => {
      pointMaterial.uniforms.uHoverRadius.value = ev.value;
    });
    bind(particlesFolder, params, 'hoverStrength', { min: 0, max: 10, step: 0.1, label: 'Hover Strength' }).on('change', (ev) => {
      pointMaterial.uniforms.uHoverStrength.value = ev.value;
    });
    bind(particlesFolder, params, 'hoverSnap', { min: 0.1, max: 10, step: 0.1, label: 'Hover Snap' }).on('change', (ev) => {
      pointMaterial.uniforms.uHoverSnap.value = ev.value;
    });
    bind(particlesFolder, params, 'hoverColor', { view: 'color', label: 'Hover Color' }).on('change', (ev) => {
      pointMaterial.uniforms.uHoverColor.value.set(ev.value);
    });
    bind(particlesFolder, params, 'mouseHoverEnabled', { label: 'Mouse Hover' }).on('change', (ev) => {
      pointMaterial.uniforms.uHoverEnabled.value = ev.value ? 1.0 : 0.0;
    });
    bind(particlesFolder, params, 'cols', { min: 64, max: 256, step: 8 }).on('change', (ev) => {
      params.cols = clampPowerOfTwo(ev.value);
      segments = Math.max(2, Math.max(params.cols, params.rows));
      scheduleRebuild();
    });
    bind(particlesFolder, params, 'rows', { min: 64, max: 256, step: 8 }).on('change', (ev) => {
      params.rows = clampPowerOfTwo(ev.value);
      segments = Math.max(2, Math.max(params.cols, params.rows));
      scheduleRebuild();
    });

    // Mask folder
    const maskFolder = pane.folder('Framing', { expanded: true });
    bind(maskFolder, params, 'maskRadius', { min: 0.1, max: 20, step: 0.1, label: 'Mask Radius' }).on('change', (ev) => {
      pointMaterial.uniforms.uMaskRadius.value = ev.value;
    });
    bind(maskFolder, params, 'maskFeather', { min: 0.0, max: 5, step: 0.1, label: 'Mask Feather' }).on('change', (ev) => {
      pointMaterial.uniforms.uMaskFeather.value = ev.value;
    });

    bind(maskFolder, params, 'maskAspect', {min:0.6,max:2.5,step:0.05,label:'Terrain width'}).on('change', e => pointMaterial.uniforms.uMaskAspect.value = e.value);
    bind(maskFolder, params, 'viewportWidth', {min:0.25,max:0.65,step:0.01,label:'Oval width'}).on('change', e => pointMaterial.uniforms.uViewportRadius.value.x = e.value);
    bind(maskFolder, params, 'viewportHeight', {min:0.2,max:0.65,step:0.01,label:'Oval height'}).on('change', e => pointMaterial.uniforms.uViewportRadius.value.y = e.value);
    bind(maskFolder, params, 'viewportFeather', {min:0.02,max:0.6,step:0.01,label:'Edge softness'}).on('change', e => pointMaterial.uniforms.uViewportFeather.value = e.value);
    bind(maskFolder, params, 'vignette', {min:0,max:0.5,step:0.01,label:'Vignette'}).on('change', e => pointMaterial.uniforms.uVignette.value = e.value);

    // Animation folder
    const animationFolder = pane.folder('Animation', { expanded: false });
    bind(animationFolder, params, 'scrollSpeed', { min: -20, max: 20, step: 0.1, label: 'Scroll Speed' }).on('change', (ev) => {
      state.scrollSpeed = ev.value;
    });
    bind(animationFolder, params, 'animateScroll', { label: 'Animate' });

    // Airplane folder
    const airplaneFolder = pane.folder('Flight · optional', { expanded: false });
    bind(airplaneFolder, params, 'airplaneEnabled', { label: 'Enable Airplane' }).on('change', (ev) => {
      airplaneState.enabled = ev.value;
      if(ev.value && !airplaneGroup) initAirplane();
      if(!ev.value) {
        camera.position.set(0,params.camHeight,params.camZ);
        applyYawPitchDeg(params.camYaw,params.camPitch);
        airplaneState.heading=0; airplaneState.strafeOffset=0; airplaneState.targetStrafeOffset=0;
        Object.keys(keysPressed).forEach(key=>keysPressed[key]=false);
        pointMaterial.uniforms.uMaskCenter.value.set(0,0);
        radarState.active=false; radarState.persistentRevealRadius=0;
        visualRings.forEach(ring=>ring.visible=false);
        pointMaterial.uniforms.uPersistentRevealRadius.value=0;
      }
      if (airplaneGroup) airplaneGroup.visible = ev.value;
      // Show/hide airplane control hints
      document.querySelectorAll('.airplane-control').forEach(el => {
        el.style.display = ev.value ? '' : 'none';
      });
      // Reset position when toggled on
      if (ev.value) {
        airplaneState.heading = 0;
        airplaneState.targetHeading = 0;
        airplaneState.y = 0;
        airplaneState.targetY = 0;
        airplaneState.tilt = 0;
        airplaneState.pitch = 0;
      }
    });
    bind(airplaneFolder, params, 'airplaneAltitudeRange', { min: 0.5, max: 5, step: 0.1, label: 'Alt Range' }).on('change', (ev) => {
      airplaneState.altitudeRange = ev.value;
    });
    bind(airplaneFolder, params, 'strafeSpeed', { min: 0.1, max: 5, step: 0.1, label: 'Strafe Speed' }).on('change', (ev) => {
      airplaneState.strafeSpeed = ev.value;
    });
    bind(airplaneFolder, params, 'strafeEasing', { min: 0.5, max: 10, step: 0.5, label: 'Strafe Easing' }).on('change', (ev) => {
      airplaneState.strafeEasing = ev.value;
    });
    bind(airplaneFolder, params, 'maxStrafe', { min: 1, max: 15, step: 0.5, label: 'Max Strafe' }).on('change', (ev) => {
      airplaneState.maxStrafe = ev.value;
    });
    bind(airplaneFolder, params, 'airplaneHeight', { min: -5, max: 1, step: 0.1, label: 'Height' }).on('change', (ev) => {
      airplaneState.height = ev.value;
    });
    bind(airplaneFolder, params, 'airplaneSize', { min: 0.2, max: 3, step: 0.1, label: 'Size' }).on('change', (ev) => {
      airplaneState.size = ev.value;
    });
    bind(airplaneFolder, params, 'airplaneDistance', { min: 1, max: 10, step: 0.1, label: 'Distance' }).on('change', (ev) => {
      airplaneState.distance = ev.value;
    });
    bind(airplaneFolder, params, 'airplaneHoverEnabled', { label: 'Ground Highlight' }).on('change', (ev) => {
      pointMaterial.uniforms.uAirplaneHoverEnabled.value = ev.value ? 1.0 : 0.0;
    });
    bind(airplaneFolder, params, 'airplaneHoverRadius', { min: 0.5, max: 5, step: 0.1, label: 'Highlight Size' }).on('change', (ev) => {
      pointMaterial.uniforms.uAirplaneHoverRadius.value = ev.value;
    });
    bind(airplaneFolder, params, 'airplaneColorSafe', { view: 'color', label: 'Safe Color' }).on('change', (ev) => {
      pointMaterial.uniforms.uAirplaneColorFar.value.set(ev.value);
    });
    bind(airplaneFolder, params, 'airplaneColorDanger', { view: 'color', label: 'Danger Color' }).on('change', (ev) => {
      pointMaterial.uniforms.uAirplaneColorClose.value.set(ev.value);
    });

    
    // Radar folder
    const radarFolder = pane.folder('Radar (Spacebar)', { expanded: false });
    radarFolder.button('Trigger radar pulse').on('click', triggerRadarPulse);
    bind(radarFolder, radarState, 'showRing', { label: 'Show Color Ring' });
    bind(radarFolder, radarState, 'maxRadius', { min: 10, max: 50, step: 1, label: 'Max Radius' });
    bind(radarFolder, radarState, 'expandDuration', { min: 0.5, max: 5, step: 0.1, label: 'Expand Time' });
    bind(radarFolder, radarState, 'persistDuration', { min: 1, max: 8, step: 0.5, label: 'Persist Time' });
    bind(radarFolder, radarState, 'fadeDuration', { min: 0.5, max: 3, step: 0.1, label: 'Fade Time' });
    bind(radarFolder, pointMaterial.uniforms.uRadarRingWidth, 'value', { min: 0.5, max: 5, step: 0.1, label: 'Ring Width' });
    bind(radarFolder, radarState, 'ringFeather', { min: 0.1, max: 5, step: 0.1, label: 'Ring Feather' });
    bind(radarFolder, radarState, 'rainHeight', { min: 2, max: 50, step: 0.5, label: 'Rain Height' });
    bind(radarFolder, radarState, 'rainDuration', { min: 0.1, max: 1.5, step: 0.05, label: 'Rain Speed' });
    bind(radarFolder, radarState, 'rainSpawnRadius', { min: 0, max: 5, step: 0.1, label: 'Rain Origin' });
    bind(radarFolder, radarState, 'rainColor', { view: 'color', label: 'Rain Color' });
    bind(radarFolder, radarState, 'colorFadeDuration', { min: 0.1, max: 3, step: 0.1, label: 'Color Fade Time' });
    bind(radarFolder, radarState, 'ringColorLow', { view: 'color', label: 'Ring Low' });
    bind(radarFolder, radarState, 'ringColorMid', { view: 'color', label: 'Ring Mid' });
    bind(radarFolder, radarState, 'ringColorHigh', { view: 'color', label: 'Ring High' });
    bind(radarFolder, radarState, 'rainParticleWidth', { min: 0.01, max: 0.4, step: 0.01, label: 'Dash Thickness' });
    bind(radarFolder, radarState, 'rainParticleLength', { min: 1, max: 20, step: 0.5, label: 'Dash Length' });
    bind(radarFolder, radarState, 'rainImpactScale', { min: 1, max: 10, step: 0.5, label: 'Impact Size' });
    bind(radarFolder, radarState, 'visualRingEnabled', { label: 'Visual Ring' });
    bind(radarFolder, radarState, 'visualRingColor', { view: 'color', label: 'V-Ring Color' });
    bind(radarFolder, radarState, 'visualRingWidth', { min: 0.02, max: 1.0, step: 0.01, label: 'V-Ring Width' });
    bind(radarFolder, radarState, 'visualRingOpacity', { min: 0.1, max: 1.0, step: 0.05, label: 'V-Ring Opacity' });

    // Camera folder
    const cameraFolder = pane.folder('Camera', { expanded: false });
    bind(cameraFolder, params, 'camYaw', { min: -180, max: 180, step: 1, label: 'Yaw' }).on('change', (ev) => {
      applyYawPitchDeg(ev.value, params.camPitch);
    });
    bind(cameraFolder, params, 'camPitch', { min: -89, max: 89, step: 1, label: 'Pitch' }).on('change', (ev) => {
      applyYawPitchDeg(params.camYaw, ev.value);
    });
    bind(cameraFolder, params, 'camFov', { min: 20, max: 100, step: 1, label: 'FOV' }).on('change', (ev) => {
      resizeScene();
    });
    bind(cameraFolder, params, 'camHeight', { min: 0, max: 100, step: 0.1, label: 'Height' }).on('change', (ev) => {
      camera.position.y = ev.value;
    });
    bind(cameraFolder, params, 'camZ', { min: -200, max: 200, step: 0.1, label: 'Camera Z' }).on('change', (ev) => {
      camera.position.z = ev.value;
    });
    bind(cameraFolder, params, 'fogEnabled', { label: 'Fog Enabled' }).on('change', applyFogFromParams);
    bind(cameraFolder, params, 'fogColor', { view: 'color', label: 'Fog Color' }).on('change', applyFogFromParams);
    bind(cameraFolder, params, 'fogStart', { min: 0, max: 50, step: 1, label: 'Fog Start' }).on('change', applyFogFromParams);
    bind(cameraFolder, params, 'fogEnd', { min: 1, max: 50, step: 1, label: 'Fog End' }).on('change', applyFogFromParams);
    cameraFolder.button('Reset Camera').on('click', () => {
      camera.position.copy(defaultCamPos);
      camera.quaternion.copy(defaultCamQuat);
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      params.camYaw = Math.round(THREE.MathUtils.radToDeg(e.y));
      params.camPitch = Math.round(THREE.MathUtils.radToDeg(e.x));
      params.camFov = bindings.find(b=>b.key==='camFov').initial;
      resizeScene();
      params.camHeight = camera.position.y;
      params.camZ = camera.position.z;
      params.cameraMode = 'landscape';
      // Reset camera orbit
      cameraOrbit.azimuth = 0;
      cameraOrbit.elevation = 0;
      pane.refresh();
      scrollOffset.set(0, 0);
      updateTileMatrices();
    });
    bind(airplaneFolder, params, 'cameraMode', { 
      label: 'Camera Mode (G)', 
      options: { 'Landscape': 'landscape', 'Chase': 'chase', 'Top-Down': 'topdown', 'Isometric': 'isometric' }
    }).on('change', (ev) => {
      setCameraMode(ev.value);
    });
    bind(airplaneFolder, params, 'chaseCamDistance', { min: 0.5, max: 8, step: 0.1, label: 'Chase Distance' });
    bind(airplaneFolder, params, 'chaseCamHeight', { min: 0.2, max: 3, step: 0.1, label: 'Chase Height' });
    bind(airplaneFolder, params, 'topCamHeight', { min: 3, max: 20, step: 0.5, label: 'Top-Down Height' });
    bind(airplaneFolder, params, 'isoCamDistance', { min: 2, max: 15, step: 0.5, label: 'Iso Distance' });
    bind(airplaneFolder, params, 'isoCamHeight', { min: 1, max: 10, step: 0.5, label: 'Iso Height' });
    bind(airplaneFolder, params, 'chaseCamAltitude', { min: 0.5, max: 5, step: 0.1, label: 'Flight Altitude' }).on('change', (ev) => {
      airplaneState.baseAltitude = ev.value;
    });

    // Allows setting values via query params and optionally hiding the UI
    (function applyUrlParams() {
      const urlParams = new URLSearchParams(window.location.search);

      function setParam(key, paramName) {
        if (urlParams.has(paramName)) {
          const value = urlParams.get(paramName);
          if (typeof params[key] === 'boolean') {
            params[key] = value === '1' || value === 'true' || value === 'on';
        } else {
            const number = Number(value);
            if (Number.isFinite(number)) params[key] = number;
          }
        }
      }

      // hide UI if ui=0
      if (urlParams.get('ui') === '0') {
        if (!panelContainer.classList.contains('collapsed')) panelToggle.click();
      }

      // common controls
      setParam('scale', 'scale');
      setParam('tileSize', 'tileSize');
      setParam('tilesX', 'tilesX');
      setParam('tilesZ', 'tilesZ');
      setParam('pointSize', 'psize');
      setParam('maskRadius', 'mask');
      setParam('maskFeather', 'feather');
      setParam('jitter', 'jitter');
      setParam('hoverRadius', 'hR');
      setParam('hoverStrength', 'hS');
      setParam('hoverSnap', 'hSnap');
      setParam('camYaw', 'yaw');
      setParam('camPitch', 'pitch');
      setParam('camFov', 'fov');
      setParam('camHeight', 'height');
      setParam('camZ', 'z');
      setParam('scrollSpeed', 'scroll');
      setParam('animateScroll', 'animate');
      setParam('cols', 'cols');
      setParam('rows', 'rows');
      setParam('fogEnabled', 'fog');
      setParam('fogStart', 'fogStart');
      setParam('fogEnd', 'fogEnd');
      // colors as hex
      if (urlParams.has('terrain')) {
        params.terrainColor = urlParams.get('terrain');
      }
      if (urlParams.has('fogColor')) {
        params.fogColor = urlParams.get('fogColor');
      }

      for (const key of ['maskAspect','viewportWidth','viewportHeight','viewportFeather','vignette','mouseHoverEnabled']) setParam(key,key);
      // Clamp externally supplied settings to the same safe ranges as the controls.
      for (const b of bindings) {
        if (b.control._opts) b.object[b.key] = Math.max(b.control._opts.min, Math.min(b.control._opts.max,b.object[b.key]));
      }
      // Refresh pane to show URL param values
      pane.refresh();
    })();

    // Initialize camera and scene from param defaults
    (function initFromDefaults() {
      state.tileSize=params.tileSize; state.tilesX=params.tilesX; state.tilesZ=params.tilesZ;
      segments=Math.max(params.cols,params.rows);
      pointMaterial.uniforms.uMaskAspect.value=params.maskAspect;
      pointMaterial.uniforms.uViewportRadius.value.set(params.viewportWidth,params.viewportHeight);
      pointMaterial.uniforms.uViewportFeather.value=params.viewportFeather;
      pointMaterial.uniforms.uVignette.value=params.vignette;
      // Apply yaw/pitch
      applyYawPitchDeg(params.camYaw, params.camPitch);
      // Apply FOV
      camera.fov = params.camFov;
      camera.updateProjectionMatrix();
      // Apply height & camera Z
      camera.position.y = params.camHeight;
      camera.position.z = params.camZ;
      // Apply scroll speed
      state.scrollSpeed = params.scrollSpeed;
      // Grid visibility
      grid.visible = false;
      // Scale
      pointMaterial.uniforms.uScale.value = params.scale;
      pointMaterial.uniforms.uBias.value = -params.scale * 0.5;
      // Point color default
      pointMaterial.uniforms.uColor.value.set(params.terrainColor);
      // Jitter default
      pointMaterial.uniforms.uJitter.value = params.jitter;
      // Point defaults
      pointMaterial.uniforms.uPointSize.value = params.pointSize;
      pointMaterial.uniforms.uMaskRadius.value = params.maskRadius;
      pointMaterial.uniforms.uMaskFeather.value = params.maskFeather;
      // Hover defaults
      pointMaterial.uniforms.uHoverRadius.value = params.hoverRadius;
      pointMaterial.uniforms.uHoverStrength.value = params.hoverStrength;
      pointMaterial.uniforms.uHoverSnap.value = params.hoverSnap;
      pointMaterial.uniforms.uHoverColor.value.set(params.hoverColor);
      pointMaterial.uniforms.uHoverEnabled.value = params.mouseHoverEnabled ? 1.0 : 0.0;
      // Airplane hover defaults
      pointMaterial.uniforms.uAirplaneHoverEnabled.value = params.airplaneHoverEnabled ? 1.0 : 0.0;
      pointMaterial.uniforms.uAirplaneHoverRadius.value = params.airplaneHoverRadius;
      
      // Record defaults for Reset
      defaultCamPos = new THREE.Vector3().copy(camera.position);
      defaultCamQuat = new THREE.Quaternion().copy(camera.quaternion);
      // Initialize fog state
      applyFogFromParams();
      // Compile shader after defines updates
      pointMaterial.needsUpdate = true;
      // Load default heightmap texture
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        DEFAULT_HEIGHTMAP_URL,
        (tex) => {
          applyHeightmapTexture(tex).catch((err) => console.error('Failed to apply default heightmap', err));
        },
        undefined,
        (err) => {
          setStatus('The heightmap could not load. Use Reset all to retry.');
        }
      );
    })();

    // Static camera: no keyboard/mouse movement

    async function createTextureFromFile(file) {
      activeHeightmap = file.name;
      try {
        const bitmap = await createImageBitmap(file);
        const texture = new THREE.Texture(bitmap);
        texture.needsUpdate = true;
        return texture;
      } catch (err) {
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.decoding = 'async';
          i.onload = () => resolve(i);
          i.onerror = (e) => reject(e);
          i.src = dataUrl;
        });
        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        return texture;
      }
    }

    let currentHeightmapTexture = null;
    let heightmapCanvas = null;
    let heightmapCtx = null;
    let heightmapWidth = 0;
    let heightmapHeight = 0;
    let heightmapData = null; // Cached pixel data for fast sampling

    // Sample terrain height at a world XZ position using bilinear interpolation
    function sampleTerrainHeight(worldX, worldZ) {
      if (!heightmapData || !heightmapWidth || !heightmapHeight) {
        return null; // No heightmap loaded yet
      }
      
      const tileSize = state.tileSize;
      
      // Account for scroll offset - the terrain moves, so we need to sample
      // relative to the scrolling position
      const relX = worldX + scrollOffset.x;
      const relZ = worldZ + scrollOffset.y;
      
      // Convert to UV coordinates within [0,1] - the texture repeats per tile
      // The UV offset depends on whether tilesX/tilesZ are odd or even:
      // - Odd tile count: tile center at origin, so +0.5 offset needed
      // - Even tile count: tile edge at origin, so no offset needed
      const uOffset = (state.tilesX % 2) * 0.5;
      const vOffset = (state.tilesZ % 2) * 0.5;
      
      let u = (((relX / tileSize) + uOffset) % 1 + 1) % 1;
      let v = (((relZ / tileSize) + vOffset) % 1 + 1) % 1;
      
      // Convert UV to floating-point pixel coordinates for bilinear interpolation
      const fx = u * heightmapWidth - 0.5;
      const fy = v * heightmapHeight - 0.5;
      
      // Get the four surrounding pixels with wrapping
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      
      // Wrap coordinates for seamless tiling
      const wx0 = ((x0 % heightmapWidth) + heightmapWidth) % heightmapWidth;
      const wy0 = ((y0 % heightmapHeight) + heightmapHeight) % heightmapHeight;
      const wx1 = ((x1 % heightmapWidth) + heightmapWidth) % heightmapWidth;
      const wy1 = ((y1 % heightmapHeight) + heightmapHeight) % heightmapHeight;
      
      // Bilinear interpolation weights
      const tx = fx - x0;
      const ty = fy - y0;
      
      // Fast sample from cached heightmap data (RGBA, 4 bytes per pixel)
      const samplePixelHeight = (px, py) => {
        const idx = (py * heightmapWidth + px) * 4;
        return (heightmapData[idx] + heightmapData[idx + 1] + heightmapData[idx + 2]) / (255 * 3);
      };
      
      // Sample the four corners
      const h00 = samplePixelHeight(wx0, wy0);
      const h10 = samplePixelHeight(wx1, wy0);
      const h01 = samplePixelHeight(wx0, wy1);
      const h11 = samplePixelHeight(wx1, wy1);
      
      // Bilinear interpolation
      const h = h00 * (1 - tx) * (1 - ty) +
                h10 * tx * (1 - ty) +
                h01 * (1 - tx) * ty +
                h11 * tx * ty;
      
      const scale = pointMaterial.uniforms.uScale.value;
      const bias = pointMaterial.uniforms.uBias.value;
      
      return h * scale + bias;
    }

    async function applyHeightmapTexture(texture) {
      if (currentHeightmapTexture) {
        currentHeightmapTexture.dispose();
      }
      currentHeightmapTexture = texture;
      texture.colorSpace = THREE.NoColorSpace; // treat as data
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // NPOT safety: use clamp + no mipmaps; POT can repeat+mips
      const img = texture.image;
      const isPOT = img && ( (img.width & (img.width - 1)) === 0 ) && ( (img.height & (img.height - 1)) === 0 );
      if (isPOT) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
      } else {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
      }
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;

      pointMaterial.uniforms.uMap.value = texture;
      pointMaterial.uniforms.uBias.value = -pointMaterial.uniforms.uScale.value * 0.5;
      pointMaterial.needsUpdate = true;
      scheduleRebuild();
      
      // Create canvas for CPU-side heightmap sampling and cache pixel data
      const texImg = texture.image;
      if (texImg) {
        heightmapWidth = texImg.width || texImg.naturalWidth || 512;
        heightmapHeight = texImg.height || texImg.naturalHeight || 512;
        heightmapCanvas = document.createElement('canvas');
        heightmapCanvas.width = heightmapWidth;
        heightmapCanvas.height = heightmapHeight;
        heightmapCtx = heightmapCanvas.getContext('2d', { willReadFrequently: true });
        heightmapCtx.drawImage(texImg, 0, 0, heightmapWidth, heightmapHeight);
        // Cache the entire heightmap for fast sampling
        heightmapData = heightmapCtx.getImageData(0, 0, heightmapWidth, heightmapHeight).data;
      }
    }

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const texture = await createTextureFromFile(file);
        await applyHeightmapTexture(texture);
        setStatus('Heightmap loaded');
      } catch (err) {
        setStatus('Could not load this image. Try another heightmap.');
      }
    });

    function handleDropFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      createTextureFromFile(file)
        .then(applyHeightmapTexture)
        .catch(() => setStatus('Could not load this image. Try another heightmap.'));
    }

    renderer.domElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      renderer.domElement.classList.add('drag-over');
    });

    renderer.domElement.addEventListener('dragleave', () => {
      renderer.domElement.classList.remove('drag-over');
    });

    renderer.domElement.addEventListener('drop', (e) => {
      e.preventDefault();
      renderer.domElement.classList.remove('drag-over');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        handleDropFile(file);
      }
    });

    // Resize handling
    function resizeScene() {
      const width = Math.max(1,canvasContainer.clientWidth);
      const height = Math.max(1,canvasContainer.clientHeight);
      // Preserve the landscape framing as the dock changes the available aspect ratio.
      camera.aspect = width / height;
      const baseFov = THREE.MathUtils.degToRad(params.camFov);
      camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(baseFov/2)*Math.max(1,1.35/camera.aspect)));
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
      renderer.setSize(width,height);
      renderer.getDrawingBufferSize(pointMaterial.uniforms.uViewportResolution.value);
    }
    new ResizeObserver(resizeScene).observe(canvasContainer);
    window.addEventListener('resize', resizeScene);
    resizeScene();

    // Animate
    function animate() {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      pointMaterial.uniforms.uTime.value = performance.now() * 0.001;
      // Update hover center from mouse ray on ground plane
      // reuse a simple ray each frame based on last mouse NDC
      if (!window.__raycaster) window.__raycaster = new THREE.Raycaster();
      if (!window.__mouseNdc) window.__mouseNdc = new THREE.Vector2(-2, -2);
      const ray = window.__raycaster;
      ray.setFromCamera(window.__mouseNdc, camera);
      const hit = new THREE.Vector3();
      const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      if (mouseControl.active && ray.ray.intersectPlane(ground, hit)) {
        pointMaterial.uniforms.uHoverCenter.value.set(hit.x, hit.z);
      } else {
        pointMaterial.uniforms.uHoverCenter.value.set(9999.0, 9999.0);
      }
      if (params.animateScroll && tilesPoints && tilesPoints.length) {
        // Scroll direction follows airplane heading (heading 0 = -Z direction)
        const forward = new THREE.Vector3(
          Math.sin(airplaneState.heading),
          0,
          -Math.cos(airplaneState.heading)
        );
        const step = state.scrollSpeed * delta;
        scrollOffset.x += forward.x * step;
        scrollOffset.y += forward.z * step;
        updateTileMatrices();
      }
      // Update airplane
      updateAirplane(delta);
      // Update airplane hover position for shader
      if (airplaneGroup && airplaneState.enabled) {
        pointMaterial.uniforms.uAirplanePos.value.copy(airplaneGroup.position);
        // Update mask center to follow airplane in chase-style modes
        // In free roam, airplane stays at origin (0,0)
        const isChaseStyle = params.cameraMode === 'chase' || params.cameraMode === 'topdown' || params.cameraMode === 'isometric';
        if (isChaseStyle) {
          pointMaterial.uniforms.uMaskCenter.value.set(0, 0);
        }
      } else {
        pointMaterial.uniforms.uAirplanePos.value.set(9999, 9999, 9999);
      }
      
      // Update radar pulse (particle landscape effect)
      if (radarState.active) {
        const now = performance.now() * 0.001;
        const elapsed = now - radarState.startTime;
        
        // Update time uniform for rain animation
        pointMaterial.uniforms.uRadarTime.value = elapsed;
        
        // Ring expansion: grows until maxRadius, then stays there
        // This is independent of fade timing, so re-pulsing doesn't reset the ring
        if (radarState.currentRadius < radarState.maxRadius) {
          radarState.currentRadius = Math.min(elapsed * radarState.expandSpeed, radarState.maxRadius);
        }
        
        // Fade timing based on fadeEndTime (which can be extended by re-pulsing)
        const fadeStartTime = radarState.fadeEndTime - radarState.fadeDuration;
        let currentFade = 1.0;
        
        if (now >= radarState.fadeEndTime) {
          // Done - fully faded
          radarState.active = false;
          radarState.currentRadius = 0;
          radarState.persistentRevealRadius = 0.0;
          pointMaterial.uniforms.uRadarActive.value = 0.0;
          pointMaterial.uniforms.uRadarFade.value = 0.0;
          pointMaterial.uniforms.uPersistentRevealRadius.value = 0.0;
        } else if (now >= fadeStartTime) {
          // Fade out phase
          const fadeProgress = (now - fadeStartTime) / radarState.fadeDuration;
          currentFade = 1.0 - fadeProgress;
          pointMaterial.uniforms.uRadarFade.value = currentFade;
        } else {
          // Still in expand or persist phase - full visibility
          currentFade = 1.0;
          pointMaterial.uniforms.uRadarFade.value = 1.0;
        }
        
        // Update radius uniform
        pointMaterial.uniforms.uRadarRadius.value = radarState.currentRadius;
        
        // Update persistent reveal radius (only grows, never shrinks)
        radarState.persistentRevealRadius = Math.max(radarState.persistentRevealRadius, radarState.currentRadius);
        pointMaterial.uniforms.uPersistentRevealRadius.value = radarState.persistentRevealRadius;
      }
      
      // Update all visual rings (multiple independent rings)
      updateVisualRings();
      
      // Update rain particle shape uniforms in real-time
      pointMaterial.uniforms.uRainParticleWidth.value = radarState.rainParticleWidth;
      pointMaterial.uniforms.uRainParticleLength.value = radarState.rainParticleLength;
      pointMaterial.uniforms.uRainImpactScale.value = radarState.rainImpactScale;
      
      // Camera mode logic with orbit support
      // Use stable airplane position (worldPos) to avoid shake affecting camera
      // Camera positions behind the airplane based on heading direction
      if (params.cameraMode === 'chase' && airplaneGroup && airplaneState.enabled) {
        // Chase cam: positioned behind the airplane based on heading
        const chaseDist = params.chaseCamDistance;
        const chaseHeight = params.chaseCamHeight;
        
        // Use stable airplane position
        const stablePos = airplaneState.worldPos;
        
        // Calculate "behind" direction based on heading + orbit
        // heading 0 = facing -Z, so "behind" is +Z
        const behindAngle = airplaneState.heading + Math.PI + cameraOrbit.azimuth;
        const orbitX = Math.sin(behindAngle) * chaseDist;
        const orbitZ = -Math.cos(behindAngle) * chaseDist;
        // Apply elevation to height
        const elevationOffset = cameraOrbit.elevation * chaseDist;
        
        const targetCamPos = new THREE.Vector3(
          stablePos.x + orbitX,
          stablePos.y + chaseHeight + elevationOffset,
          stablePos.z + orbitZ
        );
        
        // Smooth camera movement
        camera.position.lerp(targetCamPos, Math.min(1, 8 * delta));
        
        // Look at the stable airplane position
        camera.lookAt(stablePos);
      } else if (params.cameraMode === 'topdown' && airplaneGroup && airplaneState.enabled) {
        // Top-down cam: above the airplane, rotates with heading
        const topHeight = params.topCamHeight;
        
        // Use stable airplane position (worldPos) instead of shake-affected position
        const stablePos = airplaneState.worldPos;
        
        // Apply orbit for slight offset from directly above
        const orbitOffset = cameraOrbit.elevation * topHeight * 0.5;
        const totalAngle = airplaneState.heading + cameraOrbit.azimuth;
        const orbitX = Math.sin(totalAngle) * orbitOffset;
        const orbitZ = -Math.cos(totalAngle) * orbitOffset;
        
        const targetCamPos = new THREE.Vector3(
          stablePos.x + orbitX,
          stablePos.y + topHeight,
          stablePos.z + orbitZ
        );
        
        // Smooth camera movement
        camera.position.lerp(targetCamPos, Math.min(1, 8 * delta));
        
        // For top-down, set rotation directly instead of lookAt to avoid gimbal lock
        // Rotate to look straight down (-Y), with airplane heading as "up" direction
        camera.rotation.set(-Math.PI / 2, 0, -airplaneState.heading - cameraOrbit.azimuth);
      } else if (params.cameraMode === 'isometric' && airplaneGroup && airplaneState.enabled) {
        // Isometric cam: view from behind and above based on heading
        const isoDist = params.isoCamDistance;
        const isoHeight = params.isoCamHeight;
        
        // Use stable airplane position
        const stablePos = airplaneState.worldPos;
        
        // Calculate "behind" direction based on heading + orbit
        const behindAngle = airplaneState.heading + Math.PI + cameraOrbit.azimuth;
        const orbitX = Math.sin(behindAngle) * isoDist;
        const orbitZ = -Math.cos(behindAngle) * isoDist;
        // Apply elevation to height
        const elevationOffset = cameraOrbit.elevation * isoDist;
        
        const targetCamPos = new THREE.Vector3(
          stablePos.x + orbitX,
          stablePos.y + isoHeight + elevationOffset,
          stablePos.z + orbitZ
        );
        
        // Smooth camera movement
        camera.position.lerp(targetCamPos, Math.min(1, 8 * delta));
        
        // Look at the stable airplane position
        camera.lookAt(stablePos);
      }
      
      renderer.render(scene, camera);
    }
    const credit = document.createElement('a');
    credit.href='https://github.com/sntx-labs/particle-landscape';
    credit.target='_blank'; credit.rel='noopener noreferrer'; credit.textContent='View source on GitHub';
    credit.className='panel-source'; pane._body.append(credit);
    panelContainer.querySelectorAll('.sh-ctrl').forEach(row => {
      const label=row.querySelector('.sh-label')?.textContent;
      row.querySelector('input,select')?.setAttribute('aria-label',label || 'Setting');
    });
    panelContainer.querySelectorAll('.sh-folder-head').forEach(head => {
      head.tabIndex=0; head.setAttribute('role','button');
      const sync=()=>head.setAttribute('aria-expanded',String(!head.parentElement.classList.contains('collapsed')));
      head.addEventListener('click',sync);
      head.addEventListener('keydown', e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();head.click();}});
      sync();
    });
    animate();
