/* attributes: type="module" */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
    import {
      getAuth,
      onAuthStateChanged,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      sendPasswordResetEmail,
      signOut,
      setPersistence,
      browserSessionPersistence
    } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

    import {
      getFirestore,
      doc,
      getDoc,
      setDoc,
      serverTimestamp
    } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyA03Kg26fsyKVf5um3Cp9dp4V1GuwY_YHg",
      authDomain: "vyapparedge.firebaseapp.com",
      projectId: "vyapparedge",
      storageBucket: "vyapparedge.appspot.com",
      messagingSenderId: "419655944278",
      appId: "1:419655944278:web:8288374e722c679974d3f7",
      measurementId: "G-FP9RKL44H7"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const USERS_PATH = "users";

    const loadingScreen = document.getElementById("loading-screen");
    const messageBox = document.getElementById("message-box");
    const landingContainer = document.getElementById("landing-container");
    const getStartedBtn = document.getElementById("get-started-btn");

    const authModal = document.getElementById("auth-modal");
    const closeModalBtn = document.getElementById("close-modal-btn");
    const tabLogin = document.getElementById("tab-login");
    const tabSignup = document.getElementById("tab-signup");

    const formLogin = document.getElementById("form-login");
    const formSignup = document.getElementById("form-signup");
    const formReset = document.getElementById("form-reset");

    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const resetForm = document.getElementById("reset-form");

    const loginEmail = document.getElementById("login-email");
    const loginPassword = document.getElementById("login-password");
    const signupEmail = document.getElementById("signup-email");
    const signupPassword = document.getElementById("signup-password");
    const resetEmail = document.getElementById("reset-email");

    const forgotPasswordLink = document.getElementById("forgot-password-link");
    const backToLogin = document.getElementById("back-to-login");

    function showMessage(text, isError = false) {
      messageBox.textContent = text;
      messageBox.style.display = "block";
      messageBox.style.background = isError ? "#fee2e2" : "#d1fae5";
      messageBox.style.color = isError ? "#991b1b" : "#065f46";
      clearTimeout(window.__msgTimeout);
      window.__msgTimeout = setTimeout(() => messageBox.style.display = "none", 4500);
    }

    function setAuthMode(mode) {
      tabLogin.classList.remove("active");
      tabSignup.classList.remove("active");
      formLogin.classList.remove("active");
      formSignup.classList.remove("active");
      formReset.classList.remove("active");

      if (mode === "login") { tabLogin.classList.add("active"); formLogin.classList.add("active"); }
      else if (mode === "signup") { tabSignup.classList.add("active"); formSignup.classList.add("active"); }
      else { formReset.classList.add("active"); }
    }

    /* PARTICLE CONFIGURATION */
    function initParticles() {
      if (!window.particlesJS) return;
      
      window.particlesJS("particles-js", {
        "particles": {
          "number": {
            "value": 90,
            "density": { "enable": true, "value_area": 800 }
          },
          "color": { "value": "#ff8c4a" },
          "shape": {
            "type": "circle",
            "stroke": { "width": 0, "color": "#000000" }
          },
          "opacity": {
            "value": 0.6,
            "random": false
          },
          "size": {
            "value": 4,
            "random": true
          },
          "line_linked": {
            "enable": true,
            "distance": 150,
            "color": "#1e40af",
            "opacity": 0.35,
            "width": 1.5
          },
          "move": {
            "enable": true,
            "speed": 2.5,
            "direction": "none",
            "random": false,
            "straight": false,
            "out_mode": "out",
            "bounce": false,
            "attract": { "enable": false, "rotateX": 600, "rotateY": 1200 }
          }
        },
        "interactivity": {
          "detect_on": "canvas",
          "events": {
            "onhover": { "enable": true, "mode": "grab" },
            "onclick": { "enable": true, "mode": "push" },
            "resize": true
          },
          "modes": {
            "grab": { "distance": 180, "line_linked": { "opacity": 1 } },
            "push": { "particles_nb": 4 }
          }
        },
        "retina_detect": true
      });
    }

    async function saveUserProfile(uid, email) {
      try {
        const ref = doc(db, USERS_PATH, uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            email,
            name: "New User",
            role: "staff",
            warehouseId: "main_wh",
            isActive: true,
            createdAt: serverTimestamp()
          });
        }
      } catch (e) {
        console.error("saveUserProfile error:", e);
      }
    }

    async function handleSignup(e) {
      e.preventDefault();
      const email = signupEmail.value.trim();
      const password = signupPassword.value;
      if (!email || password.length < 6) {
        showMessage("Please provide valid email & password.", true);
        return;
      }
      try {
        await setPersistence(auth, browserSessionPersistence);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await saveUserProfile(userCredential.user.uid, email);
        showMessage("Account created — redirecting...");
        authModal.style.display = "none";
      } catch (err) {
        showMessage(err.message, true);
      }
    }

    async function handleLogin(e) {
      e.preventDefault();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      if (!email || !password) {
        showMessage("Enter email and password.", true);
        return;
      }
      try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        showMessage("Login successful — redirecting...");
        authModal.style.display = "none";
      } catch (err) {
        showMessage("Invalid email or password.", true);
      }
    }

    async function handleReset(e) {
      e.preventDefault();
      const email = resetEmail.value.trim();
      if (!email) {
        showMessage("Enter your email.", true);
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        showMessage("Password reset link sent.");
        setAuthMode("login");
      } catch (err) {
        showMessage(err.message, true);
      }
    }

    
    /* -------------- AUTH STATE LISTENER -------------- */
    onAuthStateChanged(auth, (user) => {
      loadingScreen.style.display = "none";

      if (user) {
        // User logged in
        setTimeout(() => window.location.href = "http://127.0.0.1:5500/main_page.html", 700);
        return;
      } else {
        // User NOT logged in -> Show landing
        landingContainer.style.display = "flex";
        
        // !!! IMPORTANT: Initialize particles AFTER the container is visible !!!
        // We use a small timeout to ensure DOM layout is recalculated before canvas draws
        setTimeout(() => {
            initParticles();
        }, 100);
      }
    });

    /* -------------- EVENTS -------------- */
    document.addEventListener("DOMContentLoaded", () => {
      getStartedBtn.addEventListener("click", () => {
        authModal.style.display = "flex";
        setAuthMode("login");
      });

      closeModalBtn.addEventListener("click", () => authModal.style.display = "none");
      tabLogin.addEventListener("click", () => setAuthMode("login"));
      tabSignup.addEventListener("click", () => setAuthMode("signup"));

      loginForm.addEventListener("submit", handleLogin);
      signupForm.addEventListener("submit", handleSignup);
      resetForm.addEventListener("submit", handleReset);

      forgotPasswordLink.addEventListener("click", (e) => {
        e.preventDefault();
        setAuthMode("reset");
      });

      backToLogin.addEventListener("click", (e) => {
        e.preventDefault();
        setAuthMode("login");
      });

      authModal.addEventListener("click", (e) => {
        if (e.target === authModal) authModal.style.display = "none";
      });
    });
