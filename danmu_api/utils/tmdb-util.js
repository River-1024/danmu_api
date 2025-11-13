import { globals } from '../configs/globals.js';
import { log } from './log-util.js'
import { httpGet } from "./http-util.js";
import { isNonChinese } from "./zh-util.js";

// ---------------------
// TMDB API 工具方法
// ---------------------

// TMDB API 请求
async function tmdbApiGet(url) {
  const tmdbApi = "https://api.tmdb.org/3/";
  const tartgetUrl = `${tmdbApi}${url}`;
  const nextUrl = globals.proxyUrl ? `http://127.0.0.1:5321/proxy?url=${encodeURIComponent(tartgetUrl)}` : tartgetUrl;

  try {
    const response = await httpGet(nextUrl, {
      method: 'GET',
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    if (response.status != 200) return null;

    return response;
  } catch (error) {
    log("error", "[TMDB] Api error:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
    return null;
  }
}

// 使用 TMDB API 查询片名
export async function searchTmdbTitles(title, mediaType = "multi") {
  const url = `search/${mediaType}?api_key=${globals.tmdbApiKey}&query=${encodeURIComponent(title)}&language=zh-CN`;
  return await tmdbApiGet(url);
}

// 使用 TMDB API 获取日语详情
export async function getTmdbJpDetail(mediaType, tmdbId) {
  const url = `${mediaType}/${tmdbId}?api_key=${globals.tmdbApiKey}&language=ja-JP`;
  return await tmdbApiGet(url);
}

// 使用 TMDB API 获取external_ids
export async function getTmdbExternalIds(mediaType, tmdbId) {
  const url = `${mediaType}/${tmdbId}/external_ids?api_key=${globals.tmdbApiKey}`;
  return await tmdbApiGet(url);
}

// 使用TMDB API 查询日语原名搜索bahamut相关函数
export async function getTmdbJaOriginalTitle(title, signal = null) {
  if (!globals.tmdbApiKey) {
    log("info", "[TMDB] 未配置API密钥，跳过TMDB搜索");
    return null;
  }

  try {
    // 内部函数：判断单个媒体是否为动画或日语内容
    const isValidContent = (mediaInfo) => {
      const genreIds = mediaInfo.genre_ids || [];
      const genres = mediaInfo.genres || [];
      const allGenreIds = genreIds.length > 0 ? genreIds : genres.map(g => g.id);
      const originalLanguage = mediaInfo.original_language || '';
      const ANIMATION_GENRE_ID = 16;
      
      // 动画类型直接通过
      if (allGenreIds.includes(ANIMATION_GENRE_ID)) {
        return { isValid: true, reason: "明确动画类型(genre_id: 16)" };
      }
      
      // 日语内容通过（涵盖日剧、日影、日综艺）
      if (originalLanguage === 'ja') {
        return { isValid: true, reason: `原始语言为日语(ja),可能是日剧/日影/日综艺` };
      }
      
      return { 
        isValid: false, 
        reason: `非动画且非日语内容(language: ${originalLanguage}, genres: ${allGenreIds.join(',')})` 
      };
    };

    // 内部函数：批量验证搜索结果
    const validateResults = (results) => {
      if (!results || results.length === 0) {
        return { 
          hasValid: false, 
          validCount: 0, 
          totalCount: 0, 
          details: "搜索结果为空" 
        };
      }
      
      let validCount = 0;
      const validItems = [];
      
      for (const item of results) {
        const validation = isValidContent(item);
        if (validation.isValid) {
          validCount++;
          const itemTitle = item.name || item.title || "未知";
          validItems.push(`${itemTitle}(${validation.reason})`);
        }
      }
      
      return {
        hasValid: validCount > 0,
        validCount: validCount,
        totalCount: results.length,
        details: validCount > 0 
          ? `找到${validCount}个符合条件的内容: ${validItems.slice(0, 3).join(', ')}${validCount > 3 ? '...' : ''}`
          : `所有${results.length}个结果均不符合条件(非动画且非日语)`
      };
    };

    // 相似度计算函数
    const similarity = (s1, s2) => {
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      if (longer.length === 0) return 1.0;
      
      const editDistance = (str1, str2) => {
        str1 = str1.toLowerCase();
        str2 = str2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= str1.length; i++) {
          let lastValue = i;
          for (let j = 0; j <= str2.length; j++) {
            if (i === 0) {
              costs[j] = j;
            } else if (j > 0) {
              let newValue = costs[j - 1];
              if (str1.charAt(i - 1) !== str2.charAt(j - 1)) {
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
              }
              costs[j - 1] = lastValue;
              lastValue = newValue;
            }
          }
          if (i > 0) costs[str2.length] = lastValue;
        }
        return costs[str2.length];
      };
      
      return (longer.length - editDistance(longer, shorter)) / longer.length;
    };

    // 第一步：TMDB搜索
    log("info", `[TMDB] 正在搜索: ${title}`);

    // 内部中断检查
    if (signal && signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const respZh = await searchTmdbTitles(title);

    if (!respZh || !respZh.data) {
      log("info", "[TMDB] TMDB搜索结果为空");
      return null;
    }

    const dataZh = typeof respZh.data === "string" ? JSON.parse(respZh.data) : respZh.data;

    if (!dataZh.results || dataZh.results.length === 0) {
      log("info", "[TMDB] TMDB未找到任何结果");
      return null;
    }

    // 第二步：类型验证（宽松策略：只要有一个符合就继续）
    const validationResult = validateResults(dataZh.results);
    
    if (!validationResult.hasValid) {
      log("info", `[TMDB] 类型判断未通过,跳过后续搜索: ${validationResult.details}`);
      return null;
    }
    
    log("info", `[TMDB] 类型判断通过: ${validationResult.details}`);

    // 第三步：找到最相似的结果
    let bestMatch = dataZh.results[0];
    let bestScore = 0;

    for (const result of dataZh.results) {
      const resultTitle = result.name || result.title || "";
      const score = similarity(title, resultTitle);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    log("info", `[TMDB] TMDB最佳匹配: ${bestMatch.name || bestMatch.title}, 相似度: ${(bestScore * 100).toFixed(2)}%`);

    // 第四步：获取日语详情
    const mediaType = bestMatch.media_type || (bestMatch.name ? "tv" : "movie");

    // 内部中断检查
    if (signal && signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const detailResp = await getTmdbJpDetail(mediaType, bestMatch.id);

    if (!detailResp || !detailResp.data) {
      const fallbackTitle = bestMatch.name || bestMatch.title;
      log("info", `[TMDB] 使用中文搜索结果标题: ${fallbackTitle}`);
      return fallbackTitle;
    }

    const detail = typeof detailResp.data === "string" ? JSON.parse(detailResp.data) : detailResp.data;

    const jaOriginalTitle = detail.original_name || detail.original_title || detail.name || detail.title;
    log("info", `[TMDB] 找到日语原名: ${jaOriginalTitle} (相似度: ${(bestScore * 100).toFixed(2)}%)`);

    return jaOriginalTitle;

  } catch (error) {
    if (error.name === 'AbortError') {
      log("info", "[TMDB] 搜索已被中断");
      return null;
    }
    log("error", "[TMDB] Search error:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * 查询 TMDB 获取中文标题
 * @param {string} title - 标题
 * @param {number|string} season - 季数（可选）
 * @param {number|string} episode - 集数（可选）
 * @returns {Promise<string>} 返回中文标题，如果查询失败则返回原标题
 */
export async function getTMDBChineseTitle(title, season = null, episode = null) {
  // 如果包含中文，直接返回原标题
  if (!isNonChinese(title)) {
    return title;
  }

  // 判断是电影还是电视剧
  const isTV = season !== null && season !== undefined;
  const mediaType = isTV ? 'tv' : 'movie';

  try {
    // 搜索媒体内容
    const searchResponse = await searchTmdbTitles(title, mediaType);

    // 检查是否有结果
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      log("info", '[TMDB] TMDB未找到任何结果');
      return title;
    }

    // 获取第一个匹配结果的 ID
    // 查找第一个 name/title 包含中文的结果
    const firstResult = searchResponse.data.results.find(result => {
      const resultName = isTV ? result.name : result.title;
      return resultName && !isNonChinese(resultName);
    });

    // 如果没有找到包含中文的结果，使用第一个结果
    const selectedResult = firstResult || searchResponse.data.results[0];

    // 电视剧使用 name 字段，电影使用 title 字段
    const chineseTitle = isTV ? selectedResult.name : selectedResult.title;

    // 如果有中文标题则返回，否则返回原标题
    if (chineseTitle) {
      log("info", `原标题: ${title} -> 中文标题: ${chineseTitle}`);
      return chineseTitle;
    } else {
      return title;
    }

  } catch (error) {
    log("error", '查询 TMDB 时出错:', error);
    return title;
  }
}