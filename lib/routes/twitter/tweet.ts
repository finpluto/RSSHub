// @ts-nocheck
import webApiImpl from './web-api/tweet.js';

export default async (ctx) => {
    await webApiImpl(ctx);
};
