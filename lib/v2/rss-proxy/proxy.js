const parser = require('@/utils/rss-parser');
const config = require('@/config').value;

module.exports = async (ctx) => {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        ctx.throw(403, `This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
    }

    const { url } = ctx.params;
    const feed = await parser.parseURL(url);

    ctx.state.data = {
        title: feed.title,
        link: feed.link,
        description: feed.description,
        item: feed.items,
    };
};
