const socket = io();

const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');
const usernameInput = document.getElementById('username-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const uploadBtn = document.getElementById('upload-btn');

const displayUsername = document.getElementById('display-username');
const gallery = document.getElementById('gallery');
const searchInput = document.getElementById('search-input');
const downloadZipBtn = document.getElementById('download-zip-btn');

let currentUser = '';
let selectedFiles = [];

// Enable login button only if input has text
usernameInput.addEventListener('input', () => {
  loginBtn.disabled = !usernameInput.value.trim();
});

loginBtn.onclick = () => {
  currentUser = usernameInput.value.trim();
  if (!currentUser) return;
  displayUsername.textContent = currentUser;
  loginContainer.classList.add('hidden');
  mainContainer.classList.remove('hidden');
  loadGallery();
};

logoutBtn.onclick = () => {
  currentUser = '';
  selectedFiles = [];
  gallery.innerHTML = '';
  usernameInput.value = '';
  loginBtn.disabled = true;
  loginContainer.classList.remove('hidden');
  mainContainer.classList.add('hidden');
};

// Drag & drop handlers
;['dragenter', 'dragover'].forEach(eventName => {
  dropArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.add('dragover');
  });
});

;['dragleave', 'drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.remove('dragover');
  });
});

dropArea.addEventListener('drop', (e) => {
  if (!currentUser) {
    alert('Please enter your name first');
    return;
  }
  selectedFiles = [...e.dataTransfer.files];
  uploadBtn.disabled = selectedFiles.length === 0;
});

dropArea.addEventListener('click', () => {
  fileElem.click();
});

fileElem.addEventListener('change', () => {
  selectedFiles = [...fileElem.files];
  uploadBtn.disabled = selectedFiles.length === 0;
});

// Upload files
uploadBtn.onclick = async () => {
  if (!currentUser) {
    alert('Please enter your name first');
    return;
  }
  if (selectedFiles.length === 0) {
    alert('No files selected');
    return;
  }

  const formData = new FormData();
  formData.append('user', currentUser);
  selectedFiles.forEach(f => formData.append('files', f));

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const res = await fetch('/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      alert('Upload successful');
      selectedFiles = [];
      fileElem.value = '';
      uploadBtn.disabled = true;
      loadGallery();
    } else {
      alert(data.error || 'Upload failed');
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  }

  uploadBtn.textContent = 'Upload Selected';
  uploadBtn.disabled = true;
};

// Load gallery files
async function loadGallery() {
  if (!currentUser) return;
  const res = await fetch(`/files/${encodeURIComponent(currentUser)}`);
  const files = await res.json();
  renderGallery(files);
}

function renderGallery(files) {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = files.filter(f => 
    f.filename.toLowerCase().includes(query) || f.mimetype.toLowerCase().includes(query)
  );

  gallery.innerHTML = '';

  if (filtered.length === 0) {
    gallery.innerHTML = '<p>No files found</p>';
    return;
  }

  for (const file of filtered) {
    const div = document.createElement('div');
    div.className = 'gallery-item';

    let thumbHTML = '<p>No preview</p>';
    if (file.thumb) {
      if (file.mimetype.startsWith('video')) {
        thumbHTML = `<video src="/uploads/${encodeURIComponent(currentUser)}/${encodeURIComponent(file.relpath)}" controls muted preload="metadata"></video>`;
      } else if (file.mimetype.startsWith('image')) {
        thumbHTML = `<img src="/thumbs/${file.thumb}" alt="${file.filename} thumbnail" />`;
      }
    }

    div.innerHTML = `
      <strong title="${file.filename}">${file.filename}</strong><br/>
      ${thumbHTML}
      <br/>
      <a href="/download/${encodeURIComponent(currentUser)}/${encodeURIComponent(file.relpath)}" download>Download</a>
    `;
    gallery.appendChild(div);
  }
}

searchInput.addEventListener('input', loadGallery);

downloadZipBtn.addEventListener('click', () => {
  if (!currentUser) return alert('Enter your name first');
  window.location.href = `/download-zip/${encodeURIComponent(currentUser)}`;
});

// Listen to real-time updates from server
socket.on('fileUploaded', data => {
  if (data.user === currentUser) {
    loadGallery();
  }
});
