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

      // Method 0: Try public video parsing API
      try {
        console.log('Trying public video parsing API...');
        const parseApiUrl = 'https://api.tikmate.app/api/parse';
        const parseRes = await axios.post(parseApiUrl, 
          { url: resolvedUrl },
          {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 20000
          }
        );

        if (parseRes.data && parseRes.data.video_url) {
          videoUrl = parseRes.data.video_url;
          title = parseRes.data.title || '';
          cover = parseRes.data.cover || parseRes.data.thumbnail || '';
          nickname = parseRes.data.author || parseRes.data.username || '小红书作者';
          console.log('Public API success!');
        }
      } catch (e) {
        console.log('Public API failed:', e.message);
      }

      // Method 1: Try xhslink short URL to get real URL with xsec_token
      let xsecToken = '';
      let realNoteId = noteId;
      
      // Extract xsec_token from URL if present
      const xsecMatch = resolvedUrl.match(/xsec_token=([^&]+)/);
      if (xsecMatch) {
        xsecToken = xsecMatch[1];
        console.log('Found xsec_token:', xsecToken);
      }

      // Method 1.5: Try xiaohongshu web API with xsec_token
      if (xsecToken) {
        try {
          console.log('Trying xiaohongshu web API...');
          const webApiUrl = `https://www.xiaohongshu.com/api/sns/web/v1/feed?source_note_id=${noteId}&xsec_token=${xsecToken}&xsec_source=pc_share`;
          
          const webApiRes = await axios.get(webApiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
              'Referer': 'https://www.xiaohongshu.com/',
              'Origin': 'https://www.xiaohongshu.com',
              'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 15000
          });

          if (webApiRes.data && webApiRes.data.data && webApiRes.data.data.items) {
            const items = webApiRes.data.data.items;
            if (items.length > 0) {
              const noteCard = items[0].noteCard;
              if (noteCard) {
                title = noteCard.displayTitle || '';
                desc = noteCard.desc || '';
                nickname = noteCard.user?.nickname || '小红书作者';
                avatar = noteCard.user?.avatar || '';
                likes = noteCard.interactInfo?.likedCount || 0;
                comments = noteCard.interactInfo?.commentCount || 0;
                shares = noteCard.interactInfo?.shareCount || 0;
                collects = noteCard.interactInfo?.collectCount || 0;
                cover = noteCard.imageList?.[0]?.urlDefault || '';
                
                // Extract video URL
                if (noteCard.video && noteCard.video.media) {
                  const media = noteCard.video.media;
                  if (media.stream) {
                    const h264 = media.stream.h264 || [];
                    const h265 = media.stream.h265 || [];
                    if (h264.length > 0) {
                      // Sort by quality
                      const sorted = [...h264].sort((a, b) => (b.qualityType || 0) - (a.qualityType || 0));
                      videoUrl = sorted[0].masterUrl || '';
                    } else if (h265.length > 0) {
                      videoUrl = h265[0].masterUrl || '';
                    }
                  }
                }
                
                console.log('Web API success! videoUrl:', videoUrl ? 'found' : 'not found');
              }
            }
          }
        } catch (e) {
          console.log('Web API failed:', e.message);
        }
      }

      // Method 2: Try HTML page fetch with mobile UA
      try {
        console.log('Trying HTML page fetch with mobile UA...');
        const htmlResponse = await axios.get(resolvedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.38(2480) NetType/WIFI Language/zh_CN Process/app',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Upgrade-Insecure-Requests': '1'
          },
          timeout: 15000,
          decompress: true
        });

        const html = htmlResponse.data;
        console.log('HTML response received, length:', html.length);

        // Try to find __INITIAL_STATE__ in HTML
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*(?:<\/script>|$)/);
        if (stateMatch) {
          console.log('Found __INITIAL_STATE__');
          try {
            // Clean up the JSON string
            let jsonStr = stateMatch[1]
              .replace(/undefined/g, 'null')
              .replace(/\\u002F/g, '/');
            
            // Balance braces
            let braceCount = 0;
            let endIndex = 0;
            for (let i = 0; i < jsonStr.length; i++) {
              if (jsonStr[i] === '{') braceCount++;
              else if (jsonStr[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  endIndex = i + 1;
                  break;
                }
              }
            }
            jsonStr = jsonStr.slice(0, endIndex);
            
            const stateData = JSON.parse(jsonStr);
            const noteDetailMap = stateData?.note?.noteDetailMap || {};
            const noteIds = Object.keys(noteDetailMap);
            
            if (noteIds.length > 0) {
              const noteInfo = noteDetailMap[noteIds[0]]?.note;
              if (noteInfo) {
                title = noteInfo.title || '';
                desc = noteInfo.desc || '';
                nickname = noteInfo.user?.nickname || '小红书作者';
                avatar = noteInfo.user?.avatar || '';
                cover = noteInfo.imageList?.[0]?.urlDefault || noteInfo.imageList?.[0]?.url || '';
                likes = noteInfo.interactInfo?.likedCount || 0;
                comments = noteInfo.interactInfo?.commentCount || 0;
                shares = noteInfo.interactInfo?.shareCount || 0;
                collects = noteInfo.interactInfo?.collectCount || 0;
                
                // Extract video URL
                const video = noteInfo.video || {};
                if (video.stream) {
                  const h264 = video.stream.h264 || [];
                  const h265 = video.stream.h265 || [];
                  if (h264.length > 0) {
                    videoUrl = h264[0].masterUrl || h264[0].master_url || '';
                  } else if (h265.length > 0) {
                    videoUrl = h265[0].masterUrl || h265[0].master_url || '';
                  }
                }
                
                // Fallback: mediaV2
                if (!videoUrl && video.mediaV2) {
                  try {
                    const mediaV2 = JSON.parse(video.mediaV2);
                    videoUrl = mediaV2.video?.opaque1?.default_screencast_stream || 
                               mediaV2.video?.opaque1?.hd_screencast_stream || '';
                  } catch (e) {}
                }
                
                console.log('Parsed from __INITIAL_STATE__, videoUrl:', videoUrl ? 'found' : 'not found');
              }
            }
          } catch (e) {
            console.log('JSON parse error:', e.message);
          }
        }

        // Fallback: search for video URL patterns in HTML
        if (!videoUrl) {
          const patterns = [
            /"masterUrl"\s*:\s*"([^"]+)"/,
            /"master_url"\s*:\s*"([^"]+)"/,
            /https?:\/\/[^"'\s<>]+sns-video[^"'\s<>]+\.mp4[^"'\s<>]*/,
            /https?:\/\/[^"'\s<>]+xhscdn[^"'\s<>]+stream[^"'\s<>]+/
          ];
          
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
              videoUrl = match[1] || match[0];
              videoUrl = videoUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
              console.log('Found video URL via pattern');
              break;
            }
          }
        }

        // Extract title if not found
        if (!title) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          if (titleMatch) {
            title = titleMatch[1].replace(' - 小红书', '').trim();
          }
        }

        // Extract cover if not found
        if (!cover) {
          const coverMatch = html.match(/https?:\/\/[^"'\s<>]+sns-webpic[^"'\s<>]+/);
          if (coverMatch) {
            cover = coverMatch[0].replace(/\\u002F/g, '/');
          }
        }

      } catch (e) {
        console.log('HTML fetch failed:', e.message);
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
          error: '小红书视频解析失败',
          detail: '小红书有严格的反爬虫机制，服务器端无法直接获取视频。请尝试以下方法：',
          solutions: [
            '1. 使用小红书App内的"保存到本地"功能（如果作者开启了下载权限）',
            '2. 使用微信小程序工具如"耶斯去水印"、"大佬去水印"等',
            '3. 使用浏览器开发者工具手动抓取视频链接',
            '4. 尝试抖音视频链接（抖音解析成功率更高）'
          ],
          platform: 'xiaohongshu'
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
