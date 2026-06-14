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
      // Extract note ID from URL
      const noteIdMatch = resolvedUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
      const noteId = noteIdMatch ? noteIdMatch[1] : null;

      if (!noteId) {
        return res.status(400).json({ error: '无法从小红书链接中提取笔记ID' });
      }

      console.log(`Extracted note ID: ${noteId}`);

      // Try multiple parsing methods
      let videoUrl = '';
      let title = '';
      let desc = '';
      let nickname = '小红书作者';
      let avatar = '';
      let cover = '';
      let likes = 0, comments = 0, shares = 0, collects = 0;

      // Method 1: Try litchi-ai API (free)
      try {
        console.log('Trying litchi-ai API...');
        const litchiRes = await axios.post('https://api.litchi-ai.com/api/video/parse', 
          { url: resolvedUrl },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer free-demo-key'
            },
            timeout: 15000
          }
        );

        if (litchiRes.data && litchiRes.data.success && litchiRes.data.video_url) {
          videoUrl = litchiRes.data.video_url;
          title = litchiRes.data.title || '';
          cover = litchiRes.data.cover_url || '';
          desc = litchiRes.data.description || '';
          console.log('litchi-ai API success!');
        }
      } catch (e) {
        console.log('litchi-ai API failed:', e.message);
      }

      // Method 2: Try parsing HTML page if API failed
      if (!videoUrl) {
        console.log('Trying HTML parsing...');
        try {
          const htmlResponse = await axios.get(resolvedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            },
            timeout: 15000
          });

          const html = htmlResponse.data;

          // Try to find video URL in HTML with various patterns
          const patterns = [
            /"masterUrl"\s*:\s*"([^"]+)"/,
            /"master_url"\s*:\s*"([^"]+)"/,
            /"streamUrl"\s*:\s*"([^"]+)"/,
            /https?:\/\/[^"'\s]+sns-video[^"'\s]+\.mp4[^"'\s]*/,
            /https?:\/\/[^"'\s]+xhscdn[^"'\s]+\.mp4[^"'\s]*/
          ];

          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
              videoUrl = match[0].replace(/\\u002F/g, '/').replace(/\\/g, '');
              if (videoUrl.startsWith('"')) videoUrl = videoUrl.slice(1);
              if (videoUrl.endsWith('"')) videoUrl = videoUrl.slice(0, -1);
              console.log('Found video URL via pattern:', pattern.toString().slice(0, 30));
              break;
            }
          }

          // Extract title
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          if (titleMatch) {
            title = titleMatch[1].replace(' - 小红书', '').trim();
          }

          // Extract description
          const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
          if (descMatch) {
            desc = descMatch[1];
          }

          if (!title && desc) {
            title = desc.slice(0, 50);
          }

          // Extract cover
          const coverPatterns = [
            /"url"\s*:\s*"(https?:\/\/[^"]+sns-webpic[^"]+)"/,
            /"urlDefault"\s*:\s*"(https?:\/\/[^"]+)"/,
            /https?:\/\/[^"'\s]+sns-webpic[^"'\s]+/
          ];
          for (const pattern of coverPatterns) {
            const match = html.match(pattern);
            if (match) {
              cover = match[0].replace(/\\u002F/g, '/').replace(/\\/g, '');
              if (cover.startsWith('"')) cover = cover.slice(1);
              if (cover.endsWith('"')) cover = cover.slice(0, -1);
              break;
            }
          }

          // Extract nickname
          const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
          if (nicknameMatch) {
            nickname = nicknameMatch[1].replace(/\\u002F/g, '/');
          }

          // Extract statistics
          const likesMatch = html.match(/"likedCount"\s*:\s*(\d+)/);
          if (likesMatch) likes = parseInt(likesMatch[1]);
          
          const commentsMatch = html.match(/"commentCount"\s*:\s*(\d+)/);
          if (commentsMatch) comments = parseInt(commentsMatch[1]);

          const collectsMatch = html.match(/"collectedCount"\s*:\s*(\d+)/);
          if (collectsMatch) collects = parseInt(collectsMatch[1]);

          const shareMatch = html.match(/"shareCount"\s*:\s*(\d+)/);
          if (shareMatch) shares = parseInt(shareMatch[1]);

        } catch (e) {
          console.log('HTML parsing failed:', e.message);
        }
      }

      // Method 3: Construct direct video URL if we have noteId
      if (!videoUrl && noteId) {
        console.log('Trying direct URL construction...');
        // Try common video CDN patterns
        const possibleUrls = [
          `https://sns-video-qc.xhscdn.com/${noteId}.mp4`,
          `https://sns-video-al.xhscdn.com/${noteId}.mp4`,
          `https://sns-video-hw.xhscdn.com/${noteId}.mp4`
        ];
        
        for (const testUrl of possibleUrls) {
          try {
            const testRes = await axios.head(testUrl, { timeout: 5000 });
            if (testRes.status === 200) {
              videoUrl = testUrl;
              console.log('Direct URL construction success!');
              break;
            }
          } catch (e) {
            // URL doesn't exist, continue
          }
        }
      }

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
        audio_url: '',
        quality: 'Original',
        platform: 'xiaohongshu'
      };

      if (!videoUrl) {
        console.log('All parsing methods failed for XHS');
        return res.status(500).json({ 
          error: '小红书视频解析失败。小红书有严格的反爬虫机制，建议：1) 使用小红书App内的"保存到本地"功能（如果作者开启了）；2) 使用第三方小程序工具如"耶斯去水印"；3) 尝试其他视频链接。' 
        });
      }

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
