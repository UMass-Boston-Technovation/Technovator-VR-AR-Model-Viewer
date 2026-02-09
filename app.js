
// ==============================
//  SUPABASE CONFIGURATION
// ==============================
const SUPABASE_URL = "https://cdlnlhdeslmdzwbkskqc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_i5h1CPV7RNrK13PSV9ADxw_wZtD1l8z";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "models";

// ==============================
//  BABYLON.JS SETUP
// ==============================
let engine, currentScene;
const canvas = document.getElementById("renderCanvas");

async function createScene(engine, canvas, modelUrl = null) {
  const scene = new BABYLON.Scene(engine);
  scene.createDefaultEnvironment({ createSkybox: false });
  const camera = new BABYLON.ArcRotateCamera("camera",
    Math.PI / 2, Math.PI / 3, 5, BABYLON.Vector3.Zero(), scene
  );
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);

  if (modelUrl) {
    await BABYLON.SceneLoader.ImportMeshAsync("", modelUrl, "", scene);
  }
  return scene;
}

async function setupXR(scene) {
  const btnVR = document.getElementById("enter-vr");
  const btnAR = document.getElementById("enter-ar");
  const arControls = document.getElementById("ar-controls");
  const arInfo = document.getElementById("ar-info");
  const placementGuide = document.getElementById("placement-guide");

  if (!("xr" in navigator)) return;

  const arSupported = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
  const vrSupported = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync("immersive-vr");
  if (vrSupported) btnVR.disabled = false;
  if (arSupported) btnAR.disabled = false;

  const xr = await BABYLON.WebXRDefaultExperience.CreateAsync(scene, {
    optionalFeatures: ["local-floor", "bounded-floor", "hit-test", "dom-overlay"],
    domOverlay: { root: document.body }
  });

  let arSession = null;
  let modelMesh = null;
  let modelScale = 1;
  let modelRotation = 0;

  // ===== GESTURE TRACKING =====
  let touchStartDistance = 0;
  let touchStartScale = 1;
  let lastTouchX = 0;
  let lastTouchY = 0;

  function getTouchDistance(touches) {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ===== AR GESTURE LISTENERS =====
  canvas.addEventListener("touchstart", (e) => {
    if (!arSession) return;
    if (e.touches.length === 2) {
      touchStartDistance = getTouchDistance(e.touches);
      touchStartScale = modelScale;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, false);

  canvas.addEventListener("touchmove", (e) => {
    if (!arSession || !modelMesh) return;

    if (e.touches.length === 2) {
      // Two-finger pinch to scale
      const distance = getTouchDistance(e.touches);
      const scaleRatio = distance / touchStartDistance;
      modelScale = touchStartScale * scaleRatio;
      modelScale = Math.max(0.1, Math.min(5, modelScale));
      modelMesh.scaling = new BABYLON.Vector3(modelScale, modelScale, modelScale);
      e.preventDefault();
    } else if (e.touches.length === 1) {
      // Single finger drag to rotate
      const deltaX = e.touches[0].clientX - lastTouchX;
      modelRotation = deltaX * 0.01;
      if (modelMesh) {
        modelMesh.rotation.y = modelRotation;
      }
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, false);

  // ===== AR PLACEMENT WITH HIT TEST =====
  canvas.addEventListener("click", async (e) => {
    if (!arSession || !xr.baseExperience) return;

    try {
      const hitTestFeature = xr.baseExperience.features.getFeatureManager()
        .enableFeature(BABYLON.WebXRFeatureName.HIT_TEST, "latest");

      const ray = scene.createPickingRay(
        scene.pointerX,
        scene.pointerY,
        BABYLON.Matrix.Identity(),
        scene.activeCamera
      );

      const hit = scene.pickWithRay(ray, (mesh) => mesh !== modelMesh);
      
      if (modelMesh && modelMesh.parent === null) {
        // Model not placed yet
        if (hit && hit.hit) {
          modelMesh.position = hit.hit.getAbsolute(BABYLON.Space.WORLD);
          placementGuide.classList.remove("active");
          arInfo.querySelector("#ar-info-text").textContent = "Model placed! Use gestures to adjust.";
        }
      }
    } catch (err) {
      console.log("Hit test not available, using screen center placement", err);
      if (modelMesh && modelMesh.parent === null) {
        modelMesh.position = new BABYLON.Vector3(0, -0.5, -1.5);
        placementGuide.classList.remove("active");
        arInfo.querySelector("#ar-info-text").textContent = "Model placed!";
      }
    }
  });

  // ===== AR CONTROLS =====
  document.getElementById("ar-scale-up").onclick = () => {
    if (modelMesh) {
      modelScale = Math.min(5, modelScale + 0.2);
      modelMesh.scaling = new BABYLON.Vector3(modelScale, modelScale, modelScale);
    }
  };

  document.getElementById("ar-scale-down").onclick = () => {
    if (modelMesh) {
      modelScale = Math.max(0.1, modelScale - 0.2);
      modelMesh.scaling = new BABYLON.Vector3(modelScale, modelScale, modelScale);
    }
  };

  document.getElementById("ar-rotate-left").onclick = () => {
    if (modelMesh) {
      modelRotation -= 0.3;
      modelMesh.rotation.y = modelRotation;
    }
  };

  document.getElementById("ar-rotate-right").onclick = () => {
    if (modelMesh) {
      modelRotation = 0.3;
      modelMesh.rotation.y = modelRotation;
    }
  };

  document.getElementById("ar-reset").onclick = () => {
    if (modelMesh) {
      modelScale = 1;
      modelRotation = 0;
      modelMesh.scaling = new BABYLON.Vector3(1, 1, 1);
      modelMesh.rotation.y = 0;
      modelMesh.position = new BABYLON.Vector3(0, 0, 0);
    }
  };

  document.getElementById("ar-exit").onclick = () => {
    xr.baseExperience.exitXRAsync();
  };

  // ===== XR SESSION HANDLERS =====
  xr.baseExperience.onStateChangedObservable.add((state) => {
    if (state === BABYLON.WebXRState.IN_XR) {
      arControls.classList.add("active");
      arInfo.classList.add("active");
      placementGuide.classList.add("active");
      arSession = true;
    } else {
      arControls.classList.remove("active");
      arInfo.classList.remove("active");
      placementGuide.classList.remove("active");
      arSession = false;
      if (modelMesh) modelMesh.dispose();
      modelMesh = null;
    }
  });

  // Store reference to modelMesh in scene for AR mode
  scene.onBeforeCameraRenderObservable.add(() => {
    if (arSession && !modelMesh && scene.meshes.length > 1) {
      // Auto-detect loaded model
      modelMesh = scene.meshes.find(m => m !== scene.getMeshByName("default") && m.name !== "");
    }
  });

  btnVR.onclick = async () => xr.baseExperience.enterXRAsync("immersive-vr", "local-floor");
  btnAR.onclick = async () => {
    try {
      await xr.baseExperience.enterXRAsync("immersive-ar", "local");
    } catch (err) {
      alert("AR not supported on this device or browser.");
    }
  };
}

// ==============================
//  SUPABASE AUTH  STORAGE
// ==============================

async function checkUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (user) {
    document.getElementById("auth-box").style.display = "none";
    document.getElementById("upload-model").disabled = false;
    document.getElementById("logout-btn").style.display = "inline-block";
    await loadModelList(user);
  } else {
    document.getElementById("auth-box").style.display = "block";
    document.getElementById("upload-model").disabled = true;
    document.getElementById("logout-btn").style.display = "none";
  }
}

// LOGIN or SIGNUP (WORKS)
document.getElementById("login-btn").onclick = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  if (!email || !password) return alert("Enter email and password");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error && error.message.includes("Invalid login")) {
    await supabaseClient.auth.signUp({ email, password });
    alert("Account created. Check your email for confirmation.");
  } else if (data.user) {
    alert("Logged in successfully.");
  }
  await checkUser();
};

// LOGOUT (WORKS)
document.getElementById("logout-btn").onclick = async () => {
  await supabaseClient.auth.signOut();
  document.getElementById("model-select").innerHTML = '<option disabled selected value="">SELECT A MODEL</option>';
  // Clear the current model from the viewer
  if (currentScene) currentScene.dispose();
  currentScene = await createScene(engine, canvas);
  await setupXR(currentScene);
  engine.runRenderLoop(() => currentScene.render());
  await checkUser();
};

// LOAD USER'S MODELS (WORKS)
async function loadModelList(user) {
  const path = `${user.id}`;
  const { data, error } = await supabaseClient.storage.from(BUCKET).list(path, { limit: 100 });
  const select = document.getElementById("model-select");
  select.innerHTML = '<option disabled selected value="">SELECT A MODEL</option>';
  if (error) return console.error(error);

  data.forEach(item => {
    if (!item.name.match(/\.(glb|gltf|obj|fbx)$/i)) return;
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = item.name.replace(/\.[^/.]$/, "");
    select.appendChild(opt);
  });
}

// UPLOAD MODEL (WORKS)
document.getElementById("upload-model").onclick = async () => {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Please login first.");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,.gltf,.obj,.fbx";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const path = `${user.id}/${file.name}`;
    const { error } = await supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) return alert("Upload failed: " + error.message);
    alert(`✅ Uploaded ${file.name}`);
    await loadModelList(user);
  };
  input.click();
};

// SELECT MODEL TO LOAD (WORKS)
document.getElementById("model-select").onchange = async (e) => {
  const filename = e.target.value;
  const { data: { user } } = await supabaseClient.auth.getUser();
  const modelUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${user.id}/${filename}`;
  console.log("Loading model from:", modelUrl); // optional debug line
  if (currentScene) currentScene.dispose();
  currentScene = await createScene(engine, canvas, modelUrl);
  await setupXR(currentScene);
  engine.runRenderLoop(() => currentScene.render());
};

// ==============================
//  MAIN INITIALIZATION
// ==============================
(async function main() {
  engine = new BABYLON.Engine(canvas, true);
  currentScene = await createScene(engine, canvas);
  await setupXR(currentScene);
  await checkUser();
  engine.runRenderLoop(() => currentScene.render());
  window.addEventListener("resize", () => engine.resize());
})();
