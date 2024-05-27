import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import { DataItem, Route } from '@/types';
import parser from '@/utils/rss-parser';

export const route: Route = {
    path: '/:url',
    name: 'Rss Proxy',
    example: '',
    maintainers: ['Finpluto'],

    handler: async (ctx) => {
        if (!config.feature.allow_user_supply_unsafe_domain) {
            throw new ConfigNotFoundError(`This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
        }

        const { url } = ctx.req.param();
        const feed = await parser.parseURL(url);

        const dataItems: DataItem[] = feed.items!.map((item) => ({
                title: item.title!,
                description: item.content,
                pubDate: item.pubDate,
                link: item.link,
                guid: item.guid,
                category: item.categories,
            }));

        return {
            title: feed.title!,
            link: feed.link,
            description: feed.description,
            item: dataItems,
        };
    },
    features: {
        requireConfig: [
            {
                name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
                description: `This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`,
                optional: false,
            },
        ],
    },
};
