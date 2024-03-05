import crypto from 'crypto-js';

const rootUrl = 'https://www.cls.cn';

const params = {
    appName: 'CailianpressWeb',
    os: 'web',
    sv: '7.7.5',
};

const getSearchParams = (moreParams) => {
    const searchParams = new URLSearchParams({ ...params, ...moreParams });
    searchParams.sort();
    searchParams.append('sign', crypto.MD5(crypto.SHA1(searchParams.toString()).toString()).toString());
    return searchParams;
};

module.exports = {
    rootUrl,
    getSearchParams,
};
