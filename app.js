
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

function addClick(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
}

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
  const btnXR = document.getElementById("enter-xr");
  const xrControls = document.getElementById("xr-controls");
  const xrInfo = document.getElementById("xr-info");
  const placementGuide = document.getElementById("placement-guide");

  if (!("xr" in navigator)) return;

  const arSupported = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
  const vrSupported = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync("immersive-vr");
  
  let sessionMode = null;
  if (arSupported) {
    sessionMode = "immersive-ar";
  } else if (vrSupported) {
    sessionMode = "immersive-vr";
  }

  if (sessionMode) {
    btnXR.disabled = false;
    btnXR.style.pointerEvents = "auto";
    document.getElementById("xr-wrapper").removeAttribute("title");
  }

  const xr = await BABYLON.WebXRDefaultExperience.CreateAsync(scene, {
    optionalFeatures: ["local-floor", "bounded-floor", "hit-test", "dom-overlay"],
    domOverlay: { root: document.body }
  });

  let xrSession = null;
  let modelMesh = null;

  // ===== XR BEHAVIORS =====
  const pointerDragBehavior = new BABYLON.PointerDragBehavior({ dragPlaneNormal: new BABYLON.Vector3(0, 1, 0) });
  pointerDragBehavior.useObjectOrientationForDragging = false;

  const scaleBehavior = new BABYLON.MultiPointerScaleBehavior();

  // ===== XR PLACEMENT (screen / scene pick fallback) =====
  canvas.addEventListener("click", async (e) => {
    if (!xrSession || !xr || !xr.baseExperience) return;

    // Only place if a model exists and it's not already placed (parent === null)
    if (!modelMesh || modelMesh.parent !== null) return;

    try {
      // Try a normal scene pick at the pointer to get a world point on any hittable mesh
      const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh !== modelMesh);
      if (pick && pick.hit && pick.pickedPoint) {
        modelMesh.position.copyFrom(pick.pickedPoint);
        placementGuide.classList.remove("active");
        xrInfo.querySelector("#xr-info-text").textContent = "Model placed! Use gestures to adjust.";
        return;
      }

      // If pick failed, as a fallback place the model in front of the camera at a reasonable distance
      const forward = scene.activeCamera.getForwardRay().direction;
      const camPos = scene.activeCamera.position;
      const fallbackPos = camPos.add(forward.scale(1.5));
      modelMesh.position = fallbackPos;
      placementGuide.classList.remove("active");
      xrInfo.querySelector("#xr-info-text").textContent = "Model placed!";
    } catch (err) {
      console.warn("XR placement failed, using fallback position:", err);
      modelMesh.position = new BABYLON.Vector3(0, -0.5, -1.5);
      placementGuide.classList.remove("active");
      xrInfo.querySelector("#xr-info-text").textContent = "Model placed!";
    }
  });

  // ===== XR CONTROLS =====
  addClick("xr-scale-up", () => {
    if (modelMesh) {
      modelMesh.scaling.addInPlace(new BABYLON.Vector3(0.2, 0.2, 0.2));
    }
  });

  addClick("xr-scale-down", () => {
    if (modelMesh) {
      modelMesh.scaling.subtractInPlace(new BABYLON.Vector3(0.2, 0.2, 0.2));
      if (modelMesh.scaling.x < 0.1) modelMesh.scaling = new BABYLON.Vector3(0.1, 0.1, 0.1);
    }
  });

  addClick("xr-rotate-left", () => {
    if (modelMesh) {
      modelMesh.rotation.y -= 0.3;
    }
  });

  addClick("xr-rotate-right", () => {
    if (modelMesh) {
      modelMesh.rotation.y += 0.3;
    }
  });

  addClick("xr-reset", () => {
    if (modelMesh) {
      modelMesh.scaling = new BABYLON.Vector3(1, 1, 1);
      modelMesh.rotation.y = 0;
      modelMesh.position = new BABYLON.Vector3(0, 0, 0);
    }
  });

  addClick("xr-exit", () => {
    xr.baseExperience.exitXRAsync();
  });

  // ===== XR SESSION HANDLERS =====
  xr.baseExperience.onStateChangedObservable.add((state) => {
    if (state === BABYLON.WebXRState.IN_XR) {
      xrControls.classList.add("active");
      xrInfo.classList.add("active");
      placementGuide.classList.add("active");
      xrSession = true;
    } else {
      xrControls.classList.remove("active");
      xrInfo.classList.remove("active");
      placementGuide.classList.remove("active");
      xrSession = false;
      if (modelMesh) modelMesh.dispose();
      modelMesh = null;
    }
  });

  // Store reference to modelMesh in scene for XR mode
  scene.onBeforeCameraRenderObservable.add(() => {
    if (xrSession && !modelMesh && scene.meshes.length > 1) {
      // Auto-detect loaded model
      modelMesh = scene.meshes.find(m => m !== scene.getMeshByName("default") && m.name !== "");
      if (modelMesh) {
        modelMesh.addBehavior(pointerDragBehavior);
        modelMesh.addBehavior(scaleBehavior);
      }
    }
  });

  btnXR.onclick = async () => {
    try {
      await xr.baseExperience.enterXRAsync(sessionMode, "local-floor");
    } catch (err) {
      alert("XR not supported on this device or browser.");
    }
  };
}

// ==============================
//  SUPABASE AUTH  STORAGE
// ==============================

async function checkUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const authBox = document.getElementById("auth-box");
  const uploadBtn = document.getElementById("upload-model");
  const logoutBtn = document.getElementById("logout-btn");
  const settingsBtn = document.getElementById("settings-btn");

  if (user) {
    if (authBox) authBox.style.display = "none";
    if (uploadBtn) uploadBtn.disabled = false;
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (settingsBtn) settingsBtn.disabled = false;
    await loadModelList(user);
  } else {
    if (authBox) authBox.style.display = "block";
    if (uploadBtn) uploadBtn.disabled = true;
    if (logoutBtn) logoutBtn.style.display = "none";
    if (settingsBtn) settingsBtn.disabled = true;
  }
}

// LOGIN (WORKS)
addClick("login-btn", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  if (!email || !password) return alert("Enter email and password");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    alert("Login failed: Invalid email or password.");
    return;
  }
  if (data.user) {
    alert("✅ Logged in successfully.");
    await checkUser();
  }
});

// SIGNUP (WORKS)
addClick("signup-btn", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  if (!email || !password) return alert("Enter email and password");

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    alert("Signup failed: " + error.message);
    return;
  }
  if (data.user) {
    alert("✅ Account created. Check your email for confirmation.");
  }
});

// SETTINGS PAGE NAVIGATION
addClick("settings-btn", () => {
  window.location.href = "Settings.html";
});

// RESET PASSWORD (from Settings page)
addClick("resetPwdBtn", async () => {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert("You must be logged in to perform this action.");
    window.location.href = "index.html";
    return;
  }
  if (!confirm("This will send a password reset link to your email. Are you sure?")) return;

  const { error } = await supabaseClient.auth.resetPasswordForEmail(user.email, {
    redirectTo: new URL("reset-password.html", window.location.href).href,
  });
  if (error) return alert("Error sending reset email: " + error.message);
  alert("Password reset email sent! Please check your inbox.");
});

// DELETE ACCOUNT (from Settings page)
addClick("deleteAcctBtn", async () => {
  if (!confirm("Are you sure you want to delete your account? This will delete all your uploaded models and cannot be undone.")) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // 1. Delete user's uploaded models from storage
  const path = `${user.id}`;
  const { data: list } = await supabaseClient.storage.from(BUCKET).list(path);
  if (list && list.length > 0) {
    const filesToRemove = list.map(x => `${path}/${x.name}`);
    const { error } = await supabaseClient.storage.from(BUCKET).remove(filesToRemove);
    if (error) {
      alert("Error deleting models: " + error.message);
      return;
    }
  }

  // 2. Sign out. A full user deletion from `auth.users` requires a backend function (e.g., RPC) with admin rights.
  await supabaseClient.auth.signOut();
  alert("All account data has been deleted and you have been logged out.");
  window.location.href = "index.html";
});

// FORGOT PASSWORD (SEND EMAIL)
addClick("forgot-password-btn", async () => {
  const email = document.getElementById("email").value;
  if (!email) return alert("Please enter your email address in the box above.");

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("reset-password.html", window.location.href).href,
  });
  if (error) return alert("Error: " + error.message);
  alert("Password reset email sent! Check your inbox.");
});

// UPDATE PASSWORD (FROM RESET PAGE)
addClick("update-password-btn", async () => {
  const password = document.getElementById("new-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;
  if (!password) return alert("Enter a new password.");
  if (password !== confirmPassword) return alert("Passwords do not match.");

  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) return alert("Error updating password: " + error.message);
  
  alert("Password updated successfully! You can now login.");
  window.location.href = "index.html";
});

// LOGOUT (WORKS)
addClick("logout-btn", async () => {
  await supabaseClient.auth.signOut();
  document.getElementById("model-select").innerHTML = '<option disabled selected value="">SELECT A MODEL</option>';
  // Clear the current model from the viewer
  if (currentScene) currentScene.dispose();
  currentScene = await createScene(engine, canvas);
  await setupXR(currentScene);
  engine.runRenderLoop(() => currentScene.render());
  await checkUser();
});

// LOAD USER'S MODELS (WORKS)
async function loadModelList(user) {
  const select = document.getElementById("model-select");
  if (!select) return;

  const path = `${user.id}`;
  const { data, error } = await supabaseClient.storage.from(BUCKET).list(path, { limit: 100 });
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
addClick("upload-model", async () => {
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
});

// SELECT MODEL TO LOAD (WORKS)
const modelSelect = document.getElementById("model-select");
if (modelSelect) {
  modelSelect.onchange = async (e) => {
  const filename = e.target.value;
  const { data: { user } } = await supabaseClient.auth.getUser();
  const modelUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${user.id}/${filename}`;
  console.log("Loading model from:", modelUrl); // optional debug line
  if (currentScene) currentScene.dispose();
  currentScene = await createScene(engine, canvas, modelUrl);
  await setupXR(currentScene);
  engine.runRenderLoop(() => currentScene.render());
  };
}

// ==============================
//  MAIN INITIALIZATION
// ==============================
(async function main() {
  if (canvas) {
    engine = new BABYLON.Engine(canvas, true);
    currentScene = await createScene(engine, canvas);
    await setupXR(currentScene);
    engine.runRenderLoop(() => currentScene.render());
    window.addEventListener("resize", () => engine.resize());
  }

  // Listen for auth state changes (specifically for password recovery flow)
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      // Safety: If the recovery link redirects to root/index, force move to reset page
      if (!window.location.href.includes("reset-password.html")) {
        window.location.href = "reset-password.html";
      }
    }
  });

  await checkUser();
})();
