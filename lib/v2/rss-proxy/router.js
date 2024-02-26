module.exports = (router) => {
    router.get('/:url', require('./proxy'));
};
