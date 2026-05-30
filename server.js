const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to resolve redirects for short URLs
async function resolveUrl(inputUrl) {
  if (inputUrl.includes('v.douyin.com') || inputUrl.includes('xhslink.com')) {
    try {
      const res = await axios.get(inputUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        maxRedirects: 5
      });
      return res.request.res.responseUrl || inputUrl;
    } catch (e) {
      console.error('Error resolving short URL:', e.message);
      return inputUrl;
    }
  }
  return inputUrl;
}

// API endpoint to parse video URLs (Supports Douyin & Xiaohongshu)
app.post('/api/parse', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: '请提供视频分享链接' });
  }

  try {
    const resolvedUrl = await resolveUrl(url.trim());
    console.log(`Parsing URL: ${resolvedUrl}`);

    if (resolvedUrl.includes('xiaohongshu.com')) {
      // --- XIAOHONGSHU PARSING LOGIC ---
      const response = await axios.get(resolvedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 15000
      });

      const html = response.data;

      // Extract Video URL via scanning method
      let videoUrl = '';
      let index = html.indexOf('sns-video');
      while (index !== -1) {
        let start = index;
        while (start > 0 && !/[\s"'>]/.test(html[start])) {
          start--;
        }
        start++;
        let end = index;
        while (end < html.length && !/[\s"'>\\]/.test(html[end])) {
          end++;
        }
        const rawUrl = html.slice(start, end);
        if (rawUrl.includes('.mp4')) {
          videoUrl = rawUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
          if (!videoUrl.startsWith('http') && videoUrl.startsWith('//')) {
            videoUrl = 'https:' + videoUrl;
          }
          break;
        }
        index = html.indexOf('sns-video', index + 1);
      }

      if (!videoUrl) {
        return res.status(404).json({ error: '未在该小红书页面中找到视频文件。该笔记可能是纯图文，或受防盗链保护。' });
      }

      // Extract Title
      let title = '';
      const titleRegex = /<title>(.*?)<\/title>/i;
      const titleMatch = html.match(titleRegex);
      if (titleMatch) {
        title = titleMatch[1].replace(' - 小红书', '').trim();
      }

      // Extract Description
      let desc = '';
      const descRegex = /<meta\s+name="description"\s+content="(.*?)"/i;
      const descMatch = html.match(descRegex);
      if (descMatch) {
        desc = descMatch[1];
      }
      if (!title && desc) {
        title = desc.slice(0, 50);
      }

      // Extract Author Nickname
      let nickname = '小红书作者';
      const nicknameRegex = /"nickname"\s*:\s*"(.*?)"/i;
      const nicknameMatch = html.match(nicknameRegex);
      if (nicknameMatch) {
        nickname = nicknameMatch[1].replace(/\\u002F/g, '/');
      }

      // Extract Author Avatar
      let avatar = '';
      const avatarRegex = /"avatar"\s*:\s*"(.*?)"/i;
      const avatarMatch = html.match(avatarRegex);
      if (avatarMatch) {
        avatar = avatarMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        if (!avatar.startsWith('http') && avatar.startsWith('//')) {
          avatar = 'https:' + avatar;
        }
      }

      // Extract Cover Image URL
      let cover = '';
      let coverIndex = html.indexOf('sns-webpic');
      while (coverIndex !== -1) {
        let start = coverIndex;
        while (start > 0 && !/[\s"'>]/.test(html[start])) {
          start--;
        }
        start++;
        let end = coverIndex;
        while (end < html.length && !/[\s"'>\\]/.test(html[end])) {
          end++;
        }
        const rawUrl = html.slice(start, end);
        if (rawUrl.includes('!nd_')) {
          cover = rawUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
          if (!cover.startsWith('http') && cover.startsWith('//')) {
            cover = 'https:' + cover;
          }
          break;
        }
        coverIndex = html.indexOf('sns-webpic', coverIndex + 1);
      }

      // Extract Likes, Comments, Collects, Shares
      let likes = 0, comments = 0, shares = 0, collects = 0;
      const likesMatch = html.match(/"likedCount"\s*:\s*"(\d+)"/i) || html.match(/"likedCount"\s*:\s*(\d+)/i);
      if (likesMatch) likes = parseInt(likesMatch[1]);
      
      const commentsMatch = html.match(/"commentCount"\s*:\s*"(\d+)"/i) || html.match(/"commentCount"\s*:\s*(\d+)/i);
      if (commentsMatch) comments = parseInt(commentsMatch[1]);

      const collectsMatch = html.match(/"collectedCount"\s*:\s*"(\d+)"/i) || html.match(/"collectedCount"\s*:\s*(\d+)/i);
      if (collectsMatch) collects = parseInt(collectsMatch[1]);

      const shareMatch = html.match(/"shareCount"\s*:\s*"(\d+)"/i) || html.match(/"shareCount"\s*:\s*(\d+)/i);
      if (shareMatch) shares = parseInt(shareMatch[1]);

      const responseData = {
        title: title || desc || '小红书视频',
        author: {
          nickname: nickname,
          avatar: avatar
        },
        cover: cover,
        statistics: {
          likes,
          comments,
          shares,
          collects
        },
        video_url: videoUrl,
        audio_url: '', // No separate audio extraction for XHS
        quality: 'Original',
        platform: 'xiaohongshu'
      };

      return res.json(responseData);

    } else if (resolvedUrl.includes('douyin.com') || resolvedUrl.includes('iesdouyin.com')) {
      // --- DOUYIN PARSING LOGIC ---
      const apiRes = await axios.get(`https://api.douyin.wtf/api/hybrid/video_data`, {
        params: {
          url: resolvedUrl,
          minimal: false
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
      });

      if (apiRes.data && apiRes.data.code === 200 && apiRes.data.data) {
        const item = apiRes.data.data;
        const desc = item.desc || item.title || 'douyin_video';
        const author = item.author || {};
        const video = item.video || {};
        const statistics = item.statistics || {};
        const music = item.music || {};

        let videoUrl = '';
        let gearName = 'default';
        
        if (video.bit_rate && video.bit_rate.length > 0) {
          const sortedBitrate = [...video.bit_rate].sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
          const bestBitrate = sortedBitrate[0];
          const urls = bestBitrate.play_addr && bestBitrate.play_addr.url_list;
          if (urls && urls.length > 0) {
            videoUrl = urls[0];
            gearName = bestBitrate.gear_name || 'hq';
          }
        }

        if (!videoUrl && video.play_addr && video.play_addr.url_list && video.play_addr.url_list.length > 0) {
          videoUrl = video.play_addr.url_list[0];
        }
        if (!videoUrl && video.download_addr && video.download_addr.url_list && video.download_addr.url_list.length > 0) {
          videoUrl = video.download_addr.url_list[0];
        }

        let audioUrl = '';
        if (music.play_url && music.play_url.url_list && music.play_url.url_list.length > 0) {
          audioUrl = music.play_url.url_list[0];
        }

        const responseData = {
          title: desc,
          author: {
            nickname: author.nickname || 'Unknown Author',
            avatar: author.avatar_thumb && author.avatar_thumb.url_list && author.avatar_thumb.url_list[0]
          },
          cover: video.cover && video.cover.url_list && video.cover.url_list[0],
          statistics: {
            likes: statistics.digg_count || 0,
            comments: statistics.comment_count || 0,
            shares: statistics.share_count || 0,
            collects: statistics.collect_count || 0
          },
          video_url: videoUrl,
          audio_url: audioUrl,
          quality: gearName,
          platform: 'douyin'
        };

        return res.json(responseData);
      } else {
        return res.status(500).json({ error: '解析抖音视频失败，平台风控可能会拦截。' });
      }
    } else {
      return res.status(400).json({ error: '仅支持解析抖音或小红书视频链接' });
    }
  } catch (error) {
    console.error('Error during parsing:', error.message);
    const errorMsg = error.response && error.response.data && error.response.data.message 
      ? error.response.data.message 
      : error.message;
    return res.status(500).json({ error: `服务器解析错误: ${errorMsg}` });
  }
});

// Video stream proxy download endpoint (Bypasses CORS & forces browser download dialog)
app.get('/api/download-proxy', async (req, res) => {
  const { url, title, type } = req.query;
  if (!url) {
    return res.status(400).send('Missing video URL parameter');
  }

  try {
    const filename = (title || 'video').replace(/[\\/*?:"<>|]/g, '_'); // sanitize filename
    const isAudio = type === 'audio';
    const extension = isAudio ? 'mp3' : 'mp4';
    const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

    console.log(`Proxy downloading ${type || 'video'}: ${url}`);

    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': url.includes('xhscdn.com') ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/'
      },
      timeout: 30000
    });

    // Set headers to force file download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.${extension}"`);
    res.setHeader('Content-Type', contentType);
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    // Stream the content directly to the client
    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy download failed:', error.message);
    res.status(500).send(`Failed to fetch file stream: ${error.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
