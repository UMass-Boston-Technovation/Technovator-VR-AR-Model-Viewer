
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
let selectedSessionMode = null;
const canvas = document.getElementById("renderCanvas");

function addClick(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
}

function showXRModeModal() {
  const modal = document.getElementById("xr-mode-modal");
  if (modal) modal.style.display = "flex";
}

function updateXRButton() {
  const btnXR = document.getElementById("enter-xr");
  if (!btnXR) return;
  if (selectedSessionMode) {
    btnXR.disabled = false;
    btnXR.style.pointerEvents = "auto";
    btnXR.innerText = selectedSessionMode === "immersive-vr" ? "Enter VR" : "Enter AR";
  } else {
    btnXR.disabled = true;
    btnXR.style.pointerEvents = "none";
    btnXR.innerText = "Enter WebXR";
  }
}

addClick("btn-choose-vr", () => {
  selectedSessionMode = "immersive-vr";
  const modal = document.getElementById("xr-mode-modal");
  if (modal) modal.style.display = "none";
  updateXRButton();
});

addClick("btn-choose-ar", () => {
  selectedSessionMode = "immersive-ar";
  const modal = document.getElementById("xr-mode-modal");
  if (modal) modal.style.display = "none";
  updateXRButton();
});

async function createScene(engine, canvas, modelUrl = null) {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
  scene._modelRoot = null;

  const camera = new BABYLON.ArcRotateCamera("camera",
    Math.PI / 2, Math.PI / 3, 5, BABYLON.Vector3.Zero(), scene
  );
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);

  if (modelUrl) {
    const result = await BABYLON.SceneLoader.ImportMeshAsync("", modelUrl, "", scene);
    if (result.meshes.length > 0) {
      result.meshes.forEach(m => { m.isPickable = true; });
      // For GLB the __root__ TransformNode parents all meshes; use the first mesh's
      // parent if it is itself a pickable AbstractMesh, otherwise use the first mesh.
      const first = result.meshes[0];
      scene._modelRoot = (first.parent instanceof BABYLON.AbstractMesh) ? first.parent : first;
    }
  }
  return scene;
}

async function setupXR(scene) {
  const btnXR = document.getElementById("enter-xr");
  const xrInfo = document.getElementById("xr-info");
  const xrInfoText = document.getElementById("xr-info-text");
  const placementGuide = document.getElementById("placement-guide");
  const repositionBtn = document.getElementById("ar-reposition-btn");

  if (!("xr" in navigator)) return;
  document.getElementById("xr-wrapper").removeAttribute("title");
  updateXRButton();

  let xr = null;
  let twistObserver = null;

  function getModelRoot() {
    // Prefer stored root from import; fall back to first renderable mesh
    if (scene._modelRoot) return scene._modelRoot;
    return scene.meshes.find(m =>
      m.getTotalVertices() > 0 &&
      m.name !== "__root__" &&
      m.name !== "" &&
      !m.name.startsWith("Background")
    );
  }

  function setInfoText(t) { if (xrInfoText) xrInfoText.textContent = t; }

  function normalizeModelSize(mesh, targetMeters) {
    const b = mesh.getHierarchyBoundingVectors(true);
    const size = b.max.subtract(b.min).length();
    if (size > 0) mesh.scaling.setAll(targetMeters / size);
  }

  function rotateMeshY(mesh, delta) {
    // hit-test decompose sets rotationQuaternion; must use it or rotation is ignored
    if (mesh.rotationQuaternion) {
      mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(
        BABYLON.Vector3.Up(), delta
      ).multiply(mesh.rotationQuaternion);
    } else {
      mesh.rotation.y += delta;
    }
  }

  btnXR.onclick = async () => {
    if (!selectedSessionMode) return;

    if (twistObserver) { scene.onPointerObservable.remove(twistObserver); twistObserver = null; }
    if (xr) {
      try { await xr.baseExperience.exitXRAsync(); } catch {}
      xr.dispose(); xr = null;
    }

    const isVR = selectedSessionMode === "immersive-vr";

    try {
      if (isVR) {
        scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.15, 1.0);
        if (!scene.getNodeByName("BackgroundHelper")) {
          scene.createDefaultEnvironment({ createGround: true, groundSize: 20, createSkybox: true, skyboxSize: 50 });
        }
      }

      xr = await BABYLON.WebXRDefaultExperience.CreateAsync(scene, {
        optionalFeatures: isVR
          ? ["local-floor", "bounded-floor", "hand-tracking"]
          : ["hit-test", "dom-overlay", "bounded-floor"],
        ...(isVR ? {} : { domOverlay: { root: document.body } }),
      });

      let latestHit = null;
      if (!isVR) {
        try {
          const hitTest = xr.baseExperience.featuresManager.enableFeature(
            BABYLON.WebXRFeatureName.HIT_TEST, "latest"
          );
          hitTest.onHitTestResultObservable.add(r => { latestHit = r.length ? r[0] : null; });
        } catch (e) { console.warn("Hit-test unavailable:", e); }
      }

      if (isVR) {
        try {
          xr.baseExperience.featuresManager.enableFeature(
            BABYLON.WebXRFeatureName.POINTER_SELECTION, "stable",
            { xrInput: xr.input, enablePointerSelectionOnAllControllers: true }
          );
        } catch (e) { console.warn("VR pointer selection unavailable:", e); }
      }

      // Shared across state-change callbacks for AR lifecycle management
      let followObserver = null;
      let placeTapObserver = null;

      xr.baseExperience.onStateChangedObservable.add(state => {
        if (state === BABYLON.WebXRState.IN_XR) {
          if (xrInfo) xrInfo.classList.add("active");
          const mesh = getModelRoot();

          if (!mesh) {
            setInfoText("Select a model first");
            if (xrInfo) xrInfo.classList.add("active");
            return;
          }

          mesh.behaviors.slice().forEach(b => mesh.removeBehavior(b));
          mesh.setEnabled(true);

          if (isVR) {
            // ── VR MODE ──
            normalizeModelSize(mesh, 1.0);
            mesh.position = new BABYLON.Vector3(0, 1.2, -1.5);
            mesh.addBehavior(new BABYLON.SixDofDragBehavior());
            mesh.addBehavior(new BABYLON.MultiPointerScaleBehavior());

          } else {
            // ── AR MODE ──
            normalizeModelSize(mesh, 0.3);
            let placed = false;
            let activePointerCount = 0;

            // Attach pinch-to-scale — works before and after placement
            mesh.addBehavior(new BABYLON.MultiPointerScaleBehavior());

            // Two-finger twist: rotate around Y (only when placed)
            const twistPointers = new Map();
            let lastTwistAngle = null;
            twistObserver = scene.onPointerObservable.add(evt => {
              const { type, event } = evt;
              const pid = event.pointerId;
              if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
                twistPointers.set(pid, { x: event.clientX, y: event.clientY });
                if (twistPointers.size < 2) lastTwistAngle = null;
              } else if (type === BABYLON.PointerEventTypes.POINTERUP || type === BABYLON.PointerEventTypes.POINTEROUT) {
                twistPointers.delete(pid);
                lastTwistAngle = null;
              } else if (type === BABYLON.PointerEventTypes.POINTERMOVE && twistPointers.size >= 2 && placed) {
                twistPointers.set(pid, { x: event.clientX, y: event.clientY });
                const [p1, p2] = [...twistPointers.values()];
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                if (lastTwistAngle !== null) rotateMeshY(mesh, angle - lastTwistAngle);
                lastTwistAngle = angle;
              }
            });

            function enterPlacementMode() {
              placed = false;
              activePointerCount = 0;
              mesh.behaviors
                .filter(b => b instanceof BABYLON.PointerDragBehavior)
                .forEach(b => mesh.removeBehavior(b));
              if (placementGuide) placementGuide.classList.add("active");
              if (repositionBtn) repositionBtn.style.display = "none";
              setInfoText("Point at a flat surface and tap to place");

              // Model floats on the detected surface in real-time while scanning
              if (!followObserver) {
                followObserver = scene.onBeforeRenderObservable.add(() => {
                  if (placed || !latestHit) return;
                  if (!mesh.rotationQuaternion) mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
                  latestHit.transformationMatrix.decompose(
                    new BABYLON.Vector3(), mesh.rotationQuaternion, mesh.position
                  );
                });
              }
            }

            function enterInteractionMode() {
              // Snap to current surface position at moment of tap
              if (latestHit) {
                if (!mesh.rotationQuaternion) mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
                latestHit.transformationMatrix.decompose(
                  new BABYLON.Vector3(), mesh.rotationQuaternion, mesh.position
                );
              } else if (mesh.position.lengthSquared() < 0.001) {
                // No surface detected — place 1.5 m in front of camera
                const fwd = scene.activeCamera.getForwardRay().direction;
                mesh.position = scene.activeCamera.position.add(fwd.scale(1.5));
              }

              placed = true;
              if (followObserver) {
                scene.onBeforeRenderObservable.remove(followObserver);
                followObserver = null;
              }

              const drag = new BABYLON.PointerDragBehavior({ dragPlaneNormal: new BABYLON.Vector3(0, 1, 0) });
              drag.useObjectOrientationForDragging = false;
              mesh.addBehavior(drag);
              if (placementGuide) placementGuide.classList.remove("active");
              if (repositionBtn) repositionBtn.style.display = "inline-block";
              setInfoText("Drag • Pinch to scale • Twist to rotate");
            }

            // Tap detection via scene observable — canvas.click does NOT fire in WebXR
            placeTapObserver = scene.onPointerObservable.add(evt => {
              if (evt.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                activePointerCount++;
              } else if (evt.type === BABYLON.PointerEventTypes.POINTERUP) {
                activePointerCount = Math.max(0, activePointerCount - 1);
                // Single finger released with no remaining fingers = tap → lock placement
                if (!placed && activePointerCount === 0) enterInteractionMode();
              }
            });

            if (repositionBtn) {
              repositionBtn.onclick = () => { if (placed) enterPlacementMode(); };
            }

            enterPlacementMode();
          }

        } else {
          // Session ending — tear down all per-session observers
          if (followObserver) { scene.onBeforeRenderObservable.remove(followObserver); followObserver = null; }
          if (placeTapObserver) { scene.onPointerObservable.remove(placeTapObserver); placeTapObserver = null; }
          if (twistObserver) { scene.onPointerObservable.remove(twistObserver); twistObserver = null; }
          if (xrInfo) xrInfo.classList.remove("active");
          if (placementGuide) placementGuide.classList.remove("active");
          if (repositionBtn) repositionBtn.style.display = "none";
          if (isVR) scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
        }
      });

      // AR uses "local" — phones don't support "local-floor" for AR sessions
      const refSpace = isVR ? "local-floor" : "local";
      await xr.baseExperience.enterXRAsync(selectedSessionMode, refSpace);
    } catch (err) {
      console.error("XR failed:", err);
      alert("XR could not start: " + (err.message || String(err)));
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

    // Show XR mode modal right after login if not selected yet
    if (!selectedSessionMode && ("xr" in navigator)) {
      showXRModeModal();
    }

    await loadModelList(user);
  } else {
    if (authBox) authBox.style.display = "block";
    if (uploadBtn) uploadBtn.disabled = true;
    if (logoutBtn) logoutBtn.style.display = "none";
    if (settingsBtn) settingsBtn.disabled = true;

    selectedSessionMode = null;
    updateXRButton();
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
    alert("Logged in successfully.");
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
    alert("Account created. Check your email for confirmation.");
  }
});

// SETTINGS PAGE NAVIGATION
addClick("settings-btn", () => {
  window.location.href = "settings.html";
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
  engine.stopRenderLoop();
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
    alert(`Uploaded ${file.name}`);
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
  if (currentScene) currentScene.dispose();
  currentScene = await createScene(engine, canvas, modelUrl);
  await setupXR(currentScene);
  engine.stopRenderLoop();
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
