'use strict';

(async () => {
    const result = document.getElementById('s3a-v2c-result');
    const consoleErrors = [];
    const uncaught = [];
    const originalConsoleError = console.error;
    const originalOnError = window.onerror;
    const originalIndexOf = Array.prototype.indexOf;
    const rejectionHandler = (event) => uncaught.push(String(event.reason));
    const instances = [];

    function assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    function slides(count, width) {
        return Array.from({ length: count }, (_, index) =>
            `<div class="swiper-slide"${width ? ` style="width:${width}px"` : ''}>${index}</div>`
        ).join('');
    }

    function fixture(count, width) {
        const host = document.createElement('section');
        host.innerHTML = `<div class="swiper"><div class="swiper-wrapper">${slides(count, width)}</div>`
            + '<div class="swiper-pagination"></div><button class="swiper-button-prev"></button>'
            + '<button class="swiper-button-next"></button></div>';
        document.body.appendChild(host);
        return { host, element: host.querySelector('.swiper') };
    }

    function make(element, options) {
        const swiper = new Swiper(element, options);
        instances.push(swiper);
        return swiper;
    }

    function wait(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    console.error = (...args) => consoleErrors.push(args.map(String).join(' '));
    window.onerror = (message) => {
        uncaught.push(String(message));
        return true;
    };
    window.addEventListener('unhandledrejection', rejectionHandler);

    try {
        assert(typeof window.Swiper === 'function', 'global Swiper constructor is unavailable');

        const single = fixture(1);
        const singleSwiper = make(single.element, {});
        assert(singleSwiper.slides.length === 1, 'single-slide initialization failed');

        const grouped = fixture(7);
        const groupedSwiper = make(grouped.element, {
            slidesPerGroup: 3,
            navigation: { nextEl: grouped.host.querySelector('.swiper-button-next'),
                prevEl: grouped.host.querySelector('.swiper-button-prev') },
            pagination: { el: grouped.host.querySelector('.swiper-pagination'), clickable: true }
        });
        grouped.host.querySelector('.swiper-button-next').click();
        assert(groupedSwiper.activeIndex === 3, 'navigation/slidesPerGroup=3 failed');
        const bulletCount = grouped.host.querySelectorAll('.swiper-pagination-bullet').length;
        assert(bulletCount > 0 && bulletCount === groupedSwiper.snapGrid.length,
            'pagination bullets do not match grouped snap points');

        const automatic = fixture(4, 80);
        const automaticSwiper = make(automatic.element, { slidesPerView: 'auto' });
        assert(automaticSwiper.params.slidesPerView === 'auto', "slidesPerView:'auto' was not retained");

        const playing = fixture(3);
        const playingSwiper = make(playing.element, {
            loop: true,
            autoplay: { delay: 20, disableOnInteraction: false }
        });
        const initialRealIndex = playingSwiper.realIndex;
        await wait(120);
        assert(playingSwiper.realIndex !== initialRealIndex, 'autoplay did not advance');

        Array.prototype.indexOf = () => -1;
        let advisoryThrew = false;
        try {
            Swiper.extendDefaults(JSON.parse('{"__proto__":{"polluted":"yes"}}'));
        } catch (error) {
            advisoryThrew = true;
        }
        assert(advisoryThrew || ({}).polluted === undefined,
            'GHSA-hmx5-qpq5-p643 Object.prototype pollution reproduced');

        while (instances.length) {
            const swiper = instances.pop();
            swiper.destroy(true, true);
            assert(swiper.destroyed === true, 'destroy(true,true) did not mark instance destroyed');
        }
        document.querySelectorAll('section').forEach((node) => node.remove());
    } catch (error) {
        uncaught.push(error && error.stack ? error.stack : String(error));
    } finally {
        Array.prototype.indexOf = originalIndexOf;
        delete Object.prototype.polluted;
        window.removeEventListener('unhandledrejection', rejectionHandler);
        window.onerror = originalOnError;
        console.error = originalConsoleError;
    }

    const cleanupOk = Array.prototype.indexOf === originalIndexOf
        && !Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')
        && console.error === originalConsoleError && window.onerror === originalOnError;
    const passed = cleanupOk && consoleErrors.length === 0 && uncaught.length === 0;
    result.dataset.status = passed ? 'PASS' : 'FAIL';
    result.textContent = JSON.stringify({ status: result.dataset.status, cleanupOk,
        consoleErrors, uncaught });
})();
