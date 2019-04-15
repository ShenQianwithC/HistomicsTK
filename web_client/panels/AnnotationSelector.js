import _ from 'underscore';

import { AccessType } from 'girder/constants';
import eventStream from 'girder/utilities/EventStream';
import { getCurrentUser } from 'girder/auth';
import Panel from 'girder_plugins/slicer_cli_web/views/Panel';
import AnnotationModel from 'girder_plugins/large_image/models/AnnotationModel';
import {events as girderEvents} from 'girder';

import events from '../events';
import showSaveAnnotationDialog from '../dialogs/saveAnnotation';

import annotationSelectorWidget from '../templates/panels/annotationSelector.pug';
import '../stylesheets/panels/annotationSelector.styl';

// Too many elements in the draw panel will crash the browser,
// so we only allow editing of annnotations with less than this
// many elements.
const MAX_ELEMENTS_LIST_LENGTH = 5000;
var clicked = false;

/**
 * Create a panel controlling the visibility of annotations
 * on the image view.
 */
var AnnotationSelector = Panel.extend({
    events: _.extend(Panel.prototype.events, {
        'click .h-annotation-name': '_editAnnotation',
        'click .h-toggle-annotation': 'toggleAnnotation',
        'click .h-delete-annotation': 'deleteAnnotation',
        'click .h-create-annotation': 'createAnnotation',
        'click .h-edit-annotation-metadata': 'editAnnotationMetadata',
        'click .h-show-all-annotations': 'showAllAnnotations',
        'click .h-hide-all-annotations': 'hideAllAnnotations',
        'mouseenter .h-annotation': '_highlightAnnotation',
        'mouseleave .h-annotation': '_unhighlightAnnotation',
        'change #h-toggle-labels': 'toggleLabels',
        'change #h-toggle-interactive': 'toggleInteractiveMode',
        'input #h-annotation-opacity': '_changeGlobalOpacity',
        // 'ready window': '_toggleExpandGroup',
        'click .h-annotation-group-name': '_toggleExpandGroup'
    }),

    /**
     * Create the panel.
     *
     * @param {object} settings
     * @param {AnnotationCollection} settings.collection
     *     The collection representing the annotations attached
     *     to the current image.
     */
    initialize(settings = {}) {
        // console.log('(#####)AnnotationSelector.js:initialize():this = ', this);
        this._expandedGroups = new Set();
        this._opacity = settings.opacity || 0.9;
        this.listenTo(this.collection, 'sync remove update reset change:displayed change:loading', this.render);
        this.listenTo(this.collection, 'change:highlight', this._changeAnnotationHighlight);
        this.listenTo(eventStream, 'g:event.job_status', _.debounce(this._onJobUpdate, 500));
        this.listenTo(eventStream, 'g:eventStream.start', this._refreshAnnotations);
        this.listenTo(this.collection, 'change:annotation change:groups', this._saveAnnotation);
        this.listenTo(girderEvents, 'g:login', () => {
            this.collection.reset();
            this._parentId = undefined;
        });
    },

    render() {
        const annotationGroups = this._getAnnotationGroups();
        // console.log('(#####)AnnotationSelector.js:render():annotationGroups = ', annotationGroups);
        this.$('[data-toggle="tooltip"]').tooltip('destroy');
        if (!this.viewer) {
            this.$el.empty();
            return;
        }
        this.$el.html(annotationSelectorWidget({
            id: 'annotation-panel-container',
            title: 'Annotations',
            activeAnnotation: this._activeAnnotation ? this._activeAnnotation.id : '',
            showLabels: this._showLabels,
            user: getCurrentUser() || {},
            writeAccess: this._writeAccess,
            opacity: this._opacity,
            interactiveMode: this._interactiveMode,
            expandedGroups: this._expandedGroups,
            annotationGroups,
            _
        }));
        this.$('.s-panel-content').collapse({toggle: false});
        this.$('[data-toggle="tooltip"]').tooltip({container: 'body'});
        this._changeGlobalOpacity();
        // console.log('(#####)AnnotationSelector.js:render():Ano-list', document.getElementById('h-annotation-group-name-pv'));
        // if ((document.getElementById('h-annotation-group-name-pv'))) {
        //     // console.log('(#####)AnnotationSelector.js:render():clicked_1', clicked);
        //     if (!clicked){
        //         // console.log('(#####)AnnotationSelector.js:render():clicked_2', clicked);
        //         // document.getElementById('h-annotation-group-name-pv').click();
        //         // $("#h-annotation-group-name-pv").attr('id','h-annotation-group-name-pv-clicked')
        //         // console.log('(#####)AnnotationSelector.js:render():ano-Name', document.getElementById('h-annotation-name-pv'));
        //         if ((document.getElementById('h-annotation-name-pv'))) {
        //             // console.log('(#####)AnnotationSelector.js:render():clicked_3', clicked);
        //             // document.getElementById('h-annotation-name-pv').click();
        //             $(document).ready(function(){
        //                 // document.getElementById('h-annotation-name-pv').click();
        //             });
        //         }
        //         clicked = true;
        //     }
        // }
        // this.toggleInteractiveMode()
        return this;
    },

    /**
     * Set the ItemModel associated with the annotation collection.
     * As a side effect, this resets the AnnotationCollection and
     * fetches annotations from the server associated with the
     * item.
     *
     * @param {ItemModel} item
     */
    setItem(item) {
        // console.log('(#####)AnnotationSelector.js:setItem():item = ', item);
        if (this._parentId === item.id) {
            return;
        }

        this.parentItem = item;
        this._parentId = item.id;

        if (!this._parentId) {
            this.collection.reset();
            this.render();
            return;
        }
        this.collection.offset = 0;
        this.collection.reset();
        this.collection.fetch({itemId: this._parentId});

        // console.log('(#####)AnnotationSelector.js:setItem():this = ', this);
        return this;
    },

    /**
     * Set the image "viewer" instance.  This should be a subclass
     * of `large_image/imageViewerWidget` that is capable of rendering
     * annotations.
     */
    setViewer(viewer) {
        // console.log('(#####)AnnotationSelector.js:setViewer():viewer = ', viewer);
        this.viewer = viewer;
        return this;
    },

    /**
     * Toggle the renderering of a specific annotation.  Sets the
     * `displayed` attribute of the `AnnotationModel`.
     */
    toggleAnnotation(evt) {
        var id = $(evt.currentTarget).parents('.h-annotation').data('id');
        var model = this.collection.get(id);
        console.log('(#####)AnnotationSelector.js:toggleAnnotation():$(evt.currentTarget).parents = ', $(evt.currentTarget).parents);
        console.log('(#####)AnnotationSelector.js:toggleAnnotation():model = ', model);
        model.set('displayed', !model.get('displayed'));
        if (!model.get('displayed')) {
            model.unset('highlight');
        }
    },

    /**
     * Delete an annotation from the server.
     */
    deleteAnnotation(evt) {
        // console.log('(#####)AnnotationSelector.js:deleteAnnotation():evt = ', evt);
        const id = $(evt.currentTarget).parents('.h-annotation').data('id');
        const model = this.collection.get(id);

        if (model) {
            const name = (model.get('annotation') || {}).name || '未命名标注';
            events.trigger('h:confirmDialog', {
                title: 'Warning',
                message: `确定删除标注?`,
                submitButton: 'Delete',
                onSubmit: () => {
                    this.trigger('h:deleteAnnotation', model); // delete DrawWidget panel from page
                    model.unset('displayed'); // Hide Ano in image
                    model.unset('highlight');
                    this.collection.remove(model);    // delete AnnotationSelector panel from page
                    model.destroy(); // delete documents from DB
                }
            });
        }
    },

    editAnnotationMetadata(evt) {
        // console.log('(#####)AnnotationSelector.js:editAnnotationMetadata():evt = ', evt);
        const id = $(evt.currentTarget).parents('.h-annotation').data('id');
        const model = this.collection.get(id);
        this.listenToOnce(
            showSaveAnnotationDialog(model, {title: 'Edit annotation'}),
            'g:submit',
            () => model.save()
        );
    },

    _onJobUpdate(evt) {
        if (this.parentItem && evt.data.status > 2) {
            this._refreshAnnotations();
        }
    },

    _refreshAnnotations() {
        // console.log('(#####)AnnotationSelector.js:_refreshAnnotations()');
        if (!this.parentItem || !this.parentItem.id) {
            return;
        }
        var models = this.collection.indexBy(_.property('id'));
        this.collection.offset = 0;
        this.collection.fetch({itemId: this.parentItem.id}).then(() => {
            var activeId = (this._activeAnnotation || {}).id;
            this.collection.each((model) => {
                if (!_.has(models, model.id)) {
                    model.set('displayed', true);
                } else {
                    if (models[model.id].get('displayed')) {
                        model.refresh(true);
                    }
                    model.set('displayed', models[model.id].get('displayed'));
                }
            });
            this.render();
            this._activeAnnotation = null;
            if (activeId) {
                this._setActiveAnnotation(this.collection.get(activeId));
            }
            return null;
        });
    },

    toggleLabels(evt) {
        // console.log('(#####)AnnotationSelector.js:toggleLabels():evt = ', evt);
        this._showLabels = !this._showLabels;
        this.trigger('h:toggleLabels', {
            show: this._showLabels
        });
    },

    toggleInteractiveMode(evt) {
        // console.log('(#####)AnnotationSelector.js:toggleInteractiveMode():this._interactiveMode = ', this._interactiveMode);
        this._interactiveMode = !this._interactiveMode;
        this.trigger('h:toggleInteractiveMode', this._interactiveMode);
    },

    interactiveMode() {
        // console.log('(#####)AnnotationSelector.js:interactiveMode():this._interactiveMode = ', this._interactiveMode);
        return this._interactiveMode;
    },

    _editAnnotation(evt) {
        var id = $(evt.currentTarget).parents('.h-annotation').data('id');
        this.editAnnotation(this.collection.get(id));
        console.log('(#####)AnnotationSelector.js:_editAnnotation():id = ' + id);
        // debugger;
    },

    editAnnotation(model) {
        // console.log('(#####)AnnotationSelector.js:editAnnotation():model = ', model);
        // deselect the annotation if it is already selected
        if (this._activeAnnotation && model && this._activeAnnotation.id === model.id) {
            this._activeAnnotation = null;
            this.trigger('h:editAnnotation', null);
            this.render();
            return;
        }

        if (!this._writeAccess(model)) {
            events.trigger('g:alert', {
                text: 'You do not have write access to this annotation.',
                type: 'warning',
                timeout: 2500,
                icon: 'info'
            });
            return;
        }
        this._setActiveAnnotation(model);
    },

    _setActiveAnnotation(model) {
        // console.log('(#####)AnnotationSelector.js:_setActiveAnnotation():model = ', model);
        this._activeAnnotation = model;

        if (!((model.get('annotation') || {}).elements || []).length) {
            // Only load the annotation if it hasn't already been loaded.
            // Technically, an annotation *could* have 0 elements, in which
            // case loading it again should be quick.  There doesn't seem
            // to be any other way to detect an unloaded annotation.
            model.set('loading', true);
            model.fetch().done(() => {
                this._setActiveAnnotationWithoutLoad(model);
            }).always(() => {
                model.unset('loading');
            });
        } else {
            this._setActiveAnnotationWithoutLoad(model);
        }
    },

    _setActiveAnnotationWithoutLoad(model) {
        // console.log('(#####)AnnotationSelector.js:_setActiveAnnotationWithoutLoad():model = ', model);
        const numElements = ((model.get('annotation') || {}).elements || []).length;
        if (this._activeAnnotation && this._activeAnnotation.id !== model.id) {
            return;
        }
        model.set('displayed', true);

        if (numElements > MAX_ELEMENTS_LIST_LENGTH) {
            events.trigger('g:alert', {
                text: 'This annotation has too many elements to be edited.',
                type: 'warning',
                timeout: 5000,
                icon: 'info'
            });
            this._activeAnnotation = null;
            this.trigger('h:editAnnotation', null);
        } else {
            this.trigger('h:editAnnotation', model);
        }
    },

    createAnnotation(evt) {
        // console.log('(#####)AnnotationSelector.js:createAnnotation():evt = ', evt);
        var model = new AnnotationModel({
            itemId: this.parentItem.id,
            annotation: {}
        });
        this.listenToOnce(
            showSaveAnnotationDialog(model, {title: 'Create annotation'}),
            'g:submit',
            () => {
                model.save().done(() => {
                    model.set('displayed', true);
                    this.collection.add(model);
                    this.trigger('h:editAnnotation', model);
                    this._activeAnnotation = model;
                });
            }
        );
    },

    _saveAnnotation(annotation) {
        // console.log('(#####)AnnotationSelector.js:_saveAnnotation():annotation = ', annotation);
        if (!annotation._saving && !annotation._inFetch && !annotation.get('loading')) {
            annotation._saving = true;
            this.trigger('h:redraw', annotation);
            annotation.save().always(() => {
                annotation._saving = false;
            });
        }
    },

    _writeAccess(annotation) {
        return annotation.get('_accessLevel') >= AccessType.ADMIN;
    },

    showAllAnnotations() {
        // console.log('(#####)AnnotationSelector.js:showAllAnnotations()');
        this.collection.each((model) => {
            model.set('displayed', true);
        });
    },

    hideAllAnnotations() {
        // console.log('(#####)AnnotationSelector.js:hideAllAnnotations():model');
        this.collection.each((model) => {
            model.set('displayed', false);
        });
    },

    _highlightAnnotation(evt) {
      // console.log('(#####)AnnotationSelector.js:_highlightAnnotation():model');
        const id = $(evt.currentTarget).data('id');
        const model = this.collection.get(id);
        if (model.get('displayed')) {
            this.parentView.trigger('h:highlightAnnotation', id);
        }
    },

    _unhighlightAnnotation() {
        // console.log('(#####)AnnotationSelector.js:_unhighlightAnnotation()');
        this.parentView.trigger('h:highlightAnnotation');
    },

    _changeAnnotationHighlight(model) {
        // console.log('(#####)AnnotationSelector.js:_changeAnnotationHighlight()');
        this.$(`.h-annotation[data-id="${model.id}"]`).toggleClass('h-highlight-annotation', model.get('highlighted'));
    },

    _changeGlobalOpacity() {
        // console.log('(#####)AnnotationSelector.js:_changeGlobalOpacity()');
        this._opacity = this.$('#h-annotation-opacity').val();
        this.$('.h-annotation-opacity-container')
            .attr('title', `Annotation opacity ${(this._opacity * 100).toFixed()}%`);
        this.trigger('h:annotationOpacity', this._opacity);
    },

    _toggleExpandGroup(evt) {
        const name = $(evt.currentTarget).parent().data('groupName');
        // console.log('(#####)AnnotationSelector.js:_toggleExpandGroup():name = ' + name);
        if (this._expandedGroups.has(name)) {
            this._expandedGroups.delete(name);
        } else {
            this._expandedGroups.add(name);
        }
        // console.log('(#####)AnnotationSelector.js:_toggleExpandGroup():this._expandedGroups = ' + JSON.stringify(this._expandedGroups));
        // console.log('(#####)AnnotationSelector.js:_toggleExpandGroup():this._expandedGroups:', this._expandedGroups);
        this.render();
    },

    _getAnnotationGroups() {
        // console.log('(#####)AnnotationSelector.js:_getAnnotationGroups()');
        // Annotations without elements don't have any groups, so we inject the null group
        // so that they are displayed in the panel.
        this.collection.each((a) => {
            const groups = a.get('groups') || [];
            if (!groups.length) {
                groups.push(null);
            }
        });
        const groupObject = {};
        const groups = _.union(...this.collection.map((a) => a.get('groups')));
        _.each(groups, (group) => {
            const groupList = this.collection.filter(
                (a) => _.contains(a.get('groups'), group));

            if (group === null) {
                group = 'Other';
            }
            groupObject[group] = _.sortBy(groupList, (a) => a.get('created'));
        });
        return groupObject;
    }
});

// console.log('(#####)AnnotationSelector.js:export():AnnotationSelector:', AnnotationSelector);
export default AnnotationSelector;
