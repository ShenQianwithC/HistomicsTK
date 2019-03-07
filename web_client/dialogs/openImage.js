import $ from 'jquery';

import BrowserWidget from 'girder/views/widgets/BrowserWidget';

import events from '../events';
import router from '../router';

var dialog;

function createDialog() {
    var widget = new BrowserWidget({
        parentView: null,
        titleText: '图像选择',
        submitText: '打开',
        showItems: true,
        selectItem: true,
        helpText: '请选择要打开的图像',
        rootSelectorSettings: {
            pageLimit: 50
        },
        validate: function (item) {
            if (!item.has('largeImage')) {
                return $.Deferred().reject('请选择 "large image" 图像.').promise();
            }
            return $.Deferred().resolve().promise();
        }
    });
    widget.on('g:saved', (model) => {
        if (!model) {
            return;
        }
        // reset image bounds when opening a new image
        router.setQuery('bounds', null, {trigger: false});
        router.setQuery('image', model.id, {trigger: true});
        $('.modal').girderModal('close');
    });
    return widget;
}

events.on('h:openImageUi', function () {
    if (!dialog) {
        dialog = createDialog();
    }
    dialog.setElement($('#g-dialog-container')).render();
});
