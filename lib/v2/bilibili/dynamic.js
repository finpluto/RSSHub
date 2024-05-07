const got = require('@/utils/got');
const JSONbig = require('json-bigint');
const utils = require('./utils');
const { parseDate } = require('@/utils/parse-date');
const { fallback, queryToBoolean } = require('@/utils/readable-social');
const cache = require('./cache');
const { Cookie } = require('tough-cookie');

/**
    @by CaoMeiYouRen 2020-05-05 添加注释
    注意1：以下均以card为根对象
    注意2：直接动态没有origin，转发动态有origin
    注意3：转发动态格式统一为：
        - user.uname: 用户名
        - item.content: 正文
        - item.tips: 原动态结果(例如：源动态已被作者删除、图文资源已失效)
        - origin: 与原动态一致
    注意4：本总结并不保证完善，而且未来B站可能会修改接口，因此仅供参考

    B站的动态种类繁多，大致可以总结为以下几种：
    - 文字动态
        - user.uname: 用户名
        - item.content: 正文
    - 图文动态
        - user.name: 用户名
        - item.title: 标题
        - item.description: 简介
        - item.pictures: { img_src: String }[] 图片数组，图片地址在每项的 img_src 中
    - 视频动态
        - aid: av号（以card为根对象没有bv号）
        - owner.name :用户名
        - pic: 封面
        - title: 视频标题
        - desc: 视频简介
    - 专栏动态
        - author.name: 用户名
        - image_urls: String[] 封面数组
        - id: cv号
        - title: 标题
        - summary: 简介
    - 音频动态
        - id: auId 音频id
        - upper: 上传的用户名称
        - title: 音频标题
        - author: 音频作者
        - cover: 音频封面
    - 投票动态
        - user.uname: 用户名
        - item.content: 正文
    - 活动专题页
        - user.uname 用户名
        - vest.content 正文
        - sketch.title 活动标题
        - sketch.desc_text 活动简介
        - sketch.cover_url 活动封面
        - sketch.target_url 活动地址
    - 番剧/电视剧/电影等专题页
        - cover 单集封面
        - index_title 单集标题
        - url 视频地址
        - apiSeasonInfo.title 番剧名称
        - apiSeasonInfo.cover 番剧封面
    - 直播间动态
        - roomid 直播间id
        - uname 用户名
        - title 直播间标题
        - cover 直播间封面
*/

const getTitle = (data) => {
    const major = data.module_dynamic?.major;
    if (!major) {
        return '';
    }
    if (major.none) {
        return major.none.tips;
    }
    if (major.courses) {
        return `${major.courses?.title} - ${major.courses?.sub_title}`;
    }
    if (major.live_rcmd?.content) {
        // 正在直播的动态
        return JSON.parse(major.live_rcmd.content)?.live_play_info?.title;
    }
    const type = major.type.replace('MAJOR_TYPE_', '').toLowerCase();
    return major[type]?.title;
};
const getDes = (data) => {
    let desc = '';
    if (data.module_dynamic?.desc?.text) {
        desc += data.module_dynamic.desc.text;
    }
    const major = data.module_dynamic?.major;
    // 普通转发
    if (!major) {
        return desc;
    }
    // 普通分享
    if (major?.common?.desc) {
        desc += desc ? `<br>//转发自: ${major.common.desc}` : major.common.desc;
        return desc;
    }
    // 转发的直播间
    if (major?.live) {
        return `${major.live?.desc_first}<br>${major.live?.desc_second}`;
    }
    // 正在直播的动态
    if (major.live_rcmd?.content) {
        const live_play_info = JSON.parse(major.live_rcmd.content)?.live_play_info;
        return `${live_play_info?.area_name}·${live_play_info?.watched_show?.text_large}`;
    }
    // 图文动态
    if (major?.opus) {
        return major?.opus?.summary?.text;
    }
    const type = major.type.replace('MAJOR_TYPE_', '').toLowerCase();
    return major[type]?.desc;
};

const getOriginTitle = (data) => data && getTitle(data);
const getOriginDes = (data) => data && getDes(data);
const getOriginName = (data) => data?.module_author?.name;
const getIframe = (data, disableEmbed = false) => {
    if (disableEmbed) {
        return '';
    }
    const aid = data?.module_dynamic?.major?.archive?.aid;
    const bvid = data?.module_dynamic?.major?.archive?.bvid;
    if (!aid) {
        return '';
    }
    return utils.iframe(aid, null, bvid);
};

const getImgs = (data) => {
    const imgUrls = [];
    const major = data?.module_dynamic?.major;
    if (!major) {
        return '';
    }
    // 动态图片
    if (major.opus?.pics?.length) {
        imgUrls.push(...major.opus.pics.map((e) => e.url));
    }
    // 专栏封面
    if (major.article?.covers?.length) {
        imgUrls.push(...major.article.covers);
    }
    // 相簿
    if (major.draw?.items?.length) {
        imgUrls.push(...major.draw.items.map((e) => e.src));
    }
    // 正在直播的动态
    if (major.live_rcmd?.content) {
        imgUrls.push(JSON.parse(major.live_rcmd.content)?.live_play_info?.cover);
    }
    const type = major.type.replace('MAJOR_TYPE_', '').toLowerCase();
    if (major[type]?.cover) {
        imgUrls.push(major[type].cover);
    }
    return imgUrls.map((url) => `<img src="${url}">`).join('');
};

const getUrl = (item, useAvid = false) => {
    const data = item?.modules;
    if (!data) {
        return null;
    }
    let url = '';
    let text = '';
    const major = data.module_dynamic?.major;
    if (!major) {
        return null;
    }
    switch (major?.type) {
        case 'MAJOR_TYPE_UGC_SEASON':
            url = major?.ugc_season?.jump_url || '';
            text = `合集地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_ARTICLE':
            url = `https://www.bilibili.com/read/cv${major?.article?.id}`;
            text = `专栏地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_ARCHIVE': {
            const archive = major?.archive;
            const id = useAvid ? `av${archive?.aid}` : archive?.bvid;
            url = `https://www.bilibili.com/video/${id}`;
            text = `视频地址：<a href=${url}>${url}</a>`;
            break;
        }
        case 'MAJOR_TYPE_COMMON':
            url = major?.common?.jump_url || '';
            text = `地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_OPUS':
            if (item?.type === 'DYNAMIC_TYPE_ARTICLE') {
                url = `https:${major?.opus?.jump_url}`;
                text = `专栏地址：<a href=${url}>${url}</a>`;
            } else if (item?.type === 'DYNAMIC_TYPE_DRAW') {
                url = `https:${major?.opus?.jump_url}`;
                text = `图文地址：<a href=${url}>${url}</a>`;
            }
            break;
        case 'MAJOR_TYPE_PGC': {
            const pgc = major?.pgc;
            url = `https://www.bilibili.com/bangumi/play/ep${pgc?.epid}&season_id=${pgc?.season_id}`;
            text = `剧集地址：<a href=${url}>${url}</a>`;
            break;
        }
        case 'MAJOR_TYPE_COURSES':
            url = `https://www.bilibili.com/cheese/play/ss${major?.courses?.id}`;
            text = `课程地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_MUSIC':
            url = `https://www.bilibili.com/audio/au${major?.music?.id}`;
            text = `音频地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_LIVE':
            url = `https://live.bilibili.com/${major?.live?.id}`;
            text = `直播间地址：<a href=${url}>${url}</a>`;
            break;
        case 'MAJOR_TYPE_LIVE_RCMD': {
            const live_play_info = JSON.parse(major.live_rcmd?.content || '{}')?.live_play_info;
            url = `https://live.bilibili.com/${live_play_info?.room_id}`;
            text = `直播间地址：<a href=${url}>${url}</a>`;
            break;
        }
        default:
            return null;
    }
    return {
        url,
        text,
    };
};

module.exports = async (ctx) => {
    const uid = ctx.params.uid;
    const routeParams = Object.fromEntries(new URLSearchParams(ctx.params.routeParams));
    const showEmoji = fallback(undefined, queryToBoolean(routeParams.showEmoji), false);
    const disableEmbed = fallback(undefined, queryToBoolean(routeParams.disableEmbed), false);
    const displayArticle = ctx.query.mode === 'fulltext';
    const useAvid = fallback(undefined, queryToBoolean(routeParams.useAvid), false);
    const directLink = fallback(undefined, queryToBoolean(routeParams.directLink), false);

    const cookie = await cache.getCookie(ctx);

    const response = await got({
        method: 'get',
        url: `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space`,
        searchParams: {
            host_mid: uid,
            platform: 'web',
            features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
        },
        headers: {
            Referer: `https://space.bilibili.com/${uid}/`,
            Cookie: cookie,
        },
        transformResponse: [(data) => data],
    });
    const body = JSONbig.parse(response.body);
    if (body?.code === -352) {
        cache.clearCookie(ctx);
        throw new Error('The cookie has expired, please try again.');
    }
    const items = body?.data?.items;

    const usernameAndFace = await cache.getUsernameAndFaceFromUID(ctx, uid);
    const author = usernameAndFace[0] ?? items[0]?.modules?.modules_author?.name;
    const face = usernameAndFace[1] ?? items[0]?.modules?.module_author?.face;
    ctx.cache.set(`bili-username-from-uid-${uid}`, author);
    ctx.cache.set(`bili-userface-from-uid-${uid}`, face);

    const rssItems = await Promise.all(
        items.map(async (item) => {
            // const parsed = JSONbig.parse(item.card);

            const data = item.modules;
            const origin = item?.orig?.modules;

            // link
            let link = '';
            if (item.id_str) {
                link = `https://t.bilibili.com/${item.id_str}`;
            }

            let description = getDes(data) || '';
            const title = getTitle(data) || description; // 没有 title 的时候使用 desc 填充

            // emoji
            if (data.module_dynamic?.desc?.rich_text_nodes?.length && showEmoji) {
                const nodes = data.module_dynamic?.desc?.rich_text_nodes;
                for (const node of nodes) {
                    if (node?.emoji) {
                        const emoji = node.emoji;
                        description = description.replaceAll(
                            emoji.text,
                            `<img alt="${emoji.text}" src="${emoji.icon_url}"style="margin: -1px 1px 0px; display: inline-block; width: 20px; height: 20px; vertical-align: text-bottom;" title="" referrerpolicy="no-referrer">`
                        );
                    }
                }
            }

            if (item.type === 'DYNAMIC_TYPE_ARTICLE' && displayArticle) {
                // 抓取专栏全文
                const cvid = data.module_dynamic?.major?.opus?.jump_url?.match?.(/cv(\d+)/)?.[0];
                if (cvid) {
                    description = (await cacheIn.getArticleDataFromCvid(cvid, uid)).description || '';
                }
            }

            const urlResult = getUrl(item, useAvid);
            const urlText = urlResult?.text;
            if (urlResult && directLink) {
                link = urlResult.url;
            }

            const originUrlResult = getUrl(item?.orig, useAvid);
            const originUrlText = originUrlResult?.text;
            if (originUrlResult && directLink) {
                link = originUrlResult.url;
            }

            let originDescription = '';
            const originName = getOriginName(origin);
            const originTitle = getOriginTitle(origin);
            const originDes = getOriginDes(origin);
            if (originName) {
                originDescription += `//转发自: @${getOriginName(origin)}: `;
            }
            if (originTitle) {
                originDescription += originTitle;
            }
            if (originDes) {
                originDescription += `<br>${originDes}`;
            }

            // 换行处理
            description = description.replaceAll('\r\n', '<br>').replaceAll('\n', '<br>');
            originDescription = originDescription.replaceAll('\r\n', '<br>').replaceAll('\n', '<br>');

            const descriptions = [description, originDescription, urlText, originUrlText, getIframe(data, disableEmbed), getIframe(origin, disableEmbed), getImgs(data), getImgs(origin)]
                .filter(Boolean)
                .map((e) => e?.trim())
                .join('<br>');

            return {
                title,
                description: descriptions,
                pubDate: data.module_author?.pub_ts ? parseDate(data.module_author.pub_ts, 'X') : undefined,
                link,
                author,
            };
        })
    );

    ctx.state.data = {
        title: `${author} 的 bilibili 动态`,
        link: `https://space.bilibili.com/${uid}/dynamic`,
        description: `${author} 的 bilibili 动态`,
        image: face,
        item: rssItems,
    };
};
