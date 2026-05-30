document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('url-input');
  const clearBtn = document.getElementById('clear-btn');
  const extractBtn = document.getElementById('extract-btn');
  const btnText = extractBtn.querySelector('.btn-text');
  const btnLoader = extractBtn.querySelector('.btn-loader');
  
  const skeletonLoader = document.getElementById('skeleton-loader');
  const resultCard = document.getElementById('result-card');
  
  const videoCover = document.getElementById('video-cover');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const videoTitle = document.getElementById('video-title');
  const videoQuality = document.getElementById('video-quality');
  
  const statLikes = document.getElementById('stat-likes');
  const statComments = document.getElementById('stat-comments');
  const statCollects = document.getElementById('stat-collects');
  const statShares = document.getElementById('stat-shares');
  
  const downloadVideoBtn = document.getElementById('download-video-btn');
  const downloadAudioBtn = document.getElementById('download-audio-btn');

  // Input interactions
  urlInput.addEventListener('input', () => {
    if (urlInput.value.trim().length > 0) {
      clearBtn.style.display = 'flex';
    } else {
      clearBtn.style.display = 'none';
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearBtn.style.display = 'none';
    urlInput.focus();
  });

  // Main Extract Function
  async function extractVideo() {
    const rawInput = urlInput.value.trim();
    if (!rawInput) {
      showToast('提示', '请先粘贴分享链接', 'warning');
      return;
    }

    // Extract URL from input (deals with dirty pasted text containing sharing labels)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = rawInput.match(urlRegex);
    const targetUrl = match ? match[0] : null;

    const isDouyin = targetUrl && (targetUrl.includes('douyin.com') || targetUrl.includes('iesdouyin.com'));
    const isXHS = targetUrl && (targetUrl.includes('xiaohongshu.com') || targetUrl.includes('xhslink.com'));

    if (!targetUrl || (!isDouyin && !isXHS)) {
      showToast('错误', '未能识别有效的抖音或小红书链接，请确认后重试', 'error');
      return;
    }

    // Reset layout states
    resultCard.style.display = 'none';
    skeletonLoader.style.display = 'flex';
    
    // Set button loading state
    extractBtn.disabled = true;
    btnText.textContent = '正在提取...';
    btnLoader.style.display = 'inline-block';

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: targetUrl })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || '解析失败');
      }

      // Populate preview card
      videoCover.src = result.cover || 'placeholder-cover.jpg';
      authorAvatar.src = result.author.avatar || 'placeholder-avatar.jpg';
      authorName.textContent = result.author.nickname;
      videoTitle.textContent = result.title;
      
      // Quality label mapping
      let qualityText = '原画';
      if (result.quality) {
        if (result.quality.includes('720')) qualityText = '720p HQ';
        else if (result.quality.includes('1080')) qualityText = '1080p Ultra';
        else if (result.quality === 'normal') qualityText = '标清';
        else if (result.quality === 'Original') qualityText = '小红书原画';
        else qualityText = result.quality;
      }
      videoQuality.innerHTML = `<i class="fa-solid fa-sliders"></i> 画质: ${qualityText}`;

      // Populate stats
      statLikes.textContent = formatNumber(result.statistics.likes);
      statComments.textContent = formatNumber(result.statistics.comments);
      statCollects.textContent = formatNumber(result.statistics.collects);
      statShares.textContent = formatNumber(result.statistics.shares);

      // Hook up download buttons to local proxy endpoint
      const safeTitle = result.title.slice(0, 40);
      
      if (result.video_url) {
        downloadVideoBtn.href = `/api/download-proxy?url=${encodeURIComponent(result.video_url)}&title=${encodeURIComponent(safeTitle)}&type=video`;
        downloadVideoBtn.style.display = 'flex';
      } else {
        downloadVideoBtn.style.display = 'none';
      }

      if (result.audio_url) {
        downloadAudioBtn.href = `/api/download-proxy?url=${encodeURIComponent(result.audio_url)}&title=${encodeURIComponent(safeTitle)}_audio&type=audio`;
        downloadAudioBtn.style.display = 'flex';
      } else {
        downloadAudioBtn.style.display = 'none';
      }

      // Transition layouts
      skeletonLoader.style.display = 'none';
      resultCard.style.display = 'flex';
      showToast('成功', '视频解析成功！点击下方按钮下载。', 'success');

    } catch (error) {
      console.error(error);
      skeletonLoader.style.display = 'none';
      showToast('提取失败', error.message || '网络连接错误，请稍后再试', 'error');
    } finally {
      // Restore button state
      extractBtn.disabled = false;
      btnText.textContent = '提取并解析';
      btnLoader.style.display = 'none';
    }
  }

  // Trigger extract
  extractBtn.addEventListener('click', extractVideo);
  
  // Enter key trigger
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      extractVideo();
    }
  });

  // Utility to format large stats numbers (e.g. 15400 -> 1.5w)
  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  // Toast Notification Helper
  function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${icon} toast-icon"></i>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);
    
    // Close handler
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    });

    // Auto remove
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 350);
      }
    }, 4500);
  }
});
