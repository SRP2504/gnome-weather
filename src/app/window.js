// -*- Mode: js; indent-tabs-mode: nil; c-basic-offset: 4; tab-width: 4 -*-
//
// Copyright (c) 2012 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Gnome Weather is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by the
// Free Software Foundation; either version 2 of the License, or (at your
// option) any later version.
//
// Gnome Weather is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
// for more details.
//
// You should have received a copy of the GNU General Public License along
// with Gnome Weather; if not, write to the Free Software Foundation,
// Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const GWeather = imports.gi.GWeather;
const Lang = imports.lang;

const City = imports.app.city;
const Params = imports.misc.params;
const World = imports.shared.world;
const Util = imports.misc.util;

const Gettext = imports.gettext;
const Tweener = imports.tweener.tweener;

const Page = {
    WORLD: 0,
    CITY: 1
};

const NewLocationController = new Lang.Class({
    Name: 'NewLocationController',

    _init: function(parentWindow, worldModel) {
        this._worldModel = worldModel;

        let builder = Util.loadUI('/org/gnome/Weather/Application/new-location-dialog.ui',
                                  { 'parent-window': parentWindow });

        let dialog = builder.get_object('location-dialog');
        let entry = builder.get_object('location-entry');

        dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
        dialog.add_button(Gtk.STOCK_ADD, Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        dialog.connect('response', Lang.bind(this, this._onResponse));
        entry.connect('notify::location', Lang.bind(this, this._locationChanged));

        this._dialog = dialog;
        this._entry = entry;
    },

    run: function() {
        this._dialog.show();
        this._locationChanged(this._entry);
    },

    _onResponse: function(dialog, response) {
        dialog.destroy();

        if (response != Gtk.ResponseType.OK)
            return;

        let location = this._entry.location;
        if (!location)
            return;

        this._worldModel.addLocation(location, true);
    },

    _locationChanged: function(entry) {
	    this._dialog.set_response_sensitive(Gtk.ResponseType.OK, entry.location != null);
    }
});

const MainWindow = new Lang.Class({
    Name: 'MainWindow',
    Extends: Gtk.ApplicationWindow,

    _init: function(params) {
        params = Params.fill(params, { width_request: 700,
                                       height_request: 520 });
        this.parent(params);

        this._world = this.application.world;
        this._currentInfo = null;
        this._currentPage = Page.WORLD;
        this._pageWidgets = [[],[]];
        this._settings = Util.getSettings('org.gnome.Weather.Application');

        this._providers = Util.getEnabledProviders();

        Util.initActions(this,
                         [{ name: 'new-location',
                            activate: this._newLocation },
                          { name: 'about',
                            activate: this._showAbout },
                          { name: 'close',
                            activate: this._close },
                          { name: 'selection-mode',
                            activate: this._setSelectionMode,
                            parameter_type: new GLib.VariantType('b'),
                            state: new GLib.Variant('b', false) },
                          { name: 'go-world',
                            activate: this._goWorld },
                          { name: 'select-all',
                            activate: this._selectAll },
                          { name: 'select-none',
                            activate: this._selectNone },
                          { name: 'delete-selected',
                            activate: this._deleteSelected },
                          { name: 'refresh',
                            activate: this.update }]);

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Weather/Application/window.ui');

        let grid = builder.get_object('main-panel');
        this._header = builder.get_object('header-bar');
        this.set_titlebar(this._header);
        let [title, subtitle] = this._getTitle();
        this._header.title = title;
        this._header.subtitle = subtitle;

        this._worldView = new World.WorldContentView(this.application.model, { visible: true });
        this._worldView.hide();
        let iconView = this._worldView.iconView;

        this._model = this._worldView.model;
        this._model.connect('show-info', Lang.bind(this, function(model, info) {
            this.showInfo(info);
        }));
        this._model.connect('no-cityview', Lang.bind(this, function() {
            for (let i = 0; i < this._pageWidgets[Page.WORLD].length; i++)
                this._pageWidgets[Page.WORLD][i].show_all();
        }));

        this._initialGrid = this._worldView.initialGrid;
        this._pageWidgets[Page.WORLD].push(this._initialGrid);

        let newButton = builder.get_object('new-button');
        this._pageWidgets[Page.WORLD].push(newButton);

        let goWorldButton = builder.get_object('world-button');
        this._pageWidgets[Page.CITY].push(goWorldButton);

        let goWorldButtonImage = builder.get_object('world-button-image');
        goWorldButtonImage.icon_name = (goWorldButton.get_direction() == Gtk.TextDirection.RTL ?
                                        'go-previous-rtl-symbolic' : 'go-previous-symbolic');

        let placesButton = builder.get_object('places-button');

        placesButton.set_popover(this._worldView);

        let select = builder.get_object('select-button');
        this._pageWidgets[Page.WORLD].push(select);

        let refresh = builder.get_object('refresh-button');
        this._pageWidgets[Page.CITY].push(refresh);

        let selectDone = builder.get_object('done-button');
        this._pageWidgets[Page.WORLD].push(selectDone);

        let selectionBar = builder.get_object('selection-bar');
        let selectionMenu = builder.get_object("selection-menu");

        this._selectionMenuButton = builder.get_object('selection-menu-button');
        this._selectionMenuButtonLabel = builder.get_object('selection-menu-button-label');
        this._stack = builder.get_object('main-stack');

        this._deleteButton = builder.get_object('delete-button');

        this._cityView = new City.WeatherView({ hexpand: true,
                                                vexpand: true });
        this._stack.add(this._cityView);

        this._stack.add(this._initialGrid);

        iconView.connect('item-activated', Lang.bind(this, this._itemActivated));

        iconView.connect('notify::selection-mode', Lang.bind(this, function() {
            if (iconView.selection_mode) {
                this._header.get_style_context().add_class('selection-mode');
                this._header.set_custom_title(this._selectionMenuButton);
            } else {
                this._header.get_style_context().remove_class('selection-mode');
                this._header.set_custom_title(null);
            }

            let selectionState = new GLib.Variant('b', iconView.selection_mode);
            this.lookup_action('selection-mode').set_state(selectionState);
        }));

        iconView.bind_property('selection-mode', newButton, 'visible',
                               GObject.BindingFlags.INVERT_BOOLEAN);
        iconView.bind_property('selection-mode', this._header, 'show-close-button',
                               GObject.BindingFlags.INVERT_BOOLEAN);
        iconView.bind_property('selection-mode', select, 'visible',
                               GObject.BindingFlags.INVERT_BOOLEAN);
        iconView.bind_property('selection-mode', selectDone, 'visible',
                               GObject.BindingFlags.SYNC_CREATE);
        iconView.bind_property('selection-mode', selectionBar, 'visible',
                               GObject.BindingFlags.SYNC_CREATE);
        this._worldView.bind_property('empty', this.lookup_action('selection-mode'), 'enabled',
                                      GObject.BindingFlags.SYNC_CREATE |
                                      GObject.BindingFlags.INVERT_BOOLEAN);

        this._stack.set_visible_child(this._initialGrid);

        iconView.connect('view-selection-changed', Lang.bind(this, function() {
            let items = iconView.get_selection();
            let label;
            let sensitive;

            if (items.length > 0) {
                label = Gettext.ngettext("%d selected",
                                         "%d selected",
                                         items.length).format(items.length);
                sensitive = true;
            } else {
                label = _("Click on locations to select them");
                sensitive = false;
            }

            this._selectionMenuButtonLabel.label = label;
            this._deleteButton.sensitive = sensitive;
        }));

        this.add(grid);
        grid.show_all();

        for (let i = 0; i < this._pageWidgets[Page.CITY].length; i++)
            this._pageWidgets[Page.CITY][i].hide();

        this._model.fillCityView();
    },

    update: function() {
        this._cityView.update();
    },

    _getTitle: function() {
        if (this._currentPage == Page.WORLD)
            return [_("World Weather"), null];

        let location = this._cityView.info.location;
        let city = location;
        if (location.get_level() == GWeather.LocationLevel.WEATHER_STATION)
            city = location.get_parent();

        let country = city.get_parent();
        while (country &&
               country.get_level() > GWeather.LocationLevel.COUNTRY)
            country = country.get_parent();

        if (country)
            return [city.get_name(), country.get_name()];
        else
            return [city.get_name(), null];
    },

    _goToPage: function(page) {
        for (let i = 0; i < this._pageWidgets[this._currentPage].length; i++)
            this._pageWidgets[this._currentPage][i].hide();

        for (let i = 0; i < this._pageWidgets[page].length; i++) {
            let widget = this._pageWidgets[page][i];
            if (!widget.no_show_all)
                this._pageWidgets[page][i].show();
        }

        this._currentPage = page;

        let [title, subtitle] = this._getTitle();
        this._header.title = title;
        this._header.subtitle = subtitle;
    },

    _itemActivated: function(view, id, path) {
        let [ok, iter] = view.model.get_iter(path);
        let info = view.model.get_value(iter, World.Columns.INFO);

        this.showInfo(info);
    },

    showInfo: function(info) {
        this._cityView.info = info;
        this._cityView.connectClock();
        this._stack.set_visible_child(this._cityView);
        this._goToPage(Page.CITY);
    },

    _goWorld: function() {
        this._stack.set_visible_child(this._initialGrid);
        this._goToPage(Page.WORLD);
        this._cityView.disconnectClock();
    },

    _newLocation: function() {
        let controller = new NewLocationController(this.get_toplevel(),
                                                   this._worldView.model);

        controller.run();
    },

    _setSelectionMode: function(action, param) {
        this._worldView.iconView.selection_mode = param.get_boolean();
        this._deleteButton.sensitive = false;
    },

    _selectAll: function() {
        this._worldView.iconView.selection_mode = true;
        this._worldView.iconView.select_all();
    },

    _selectNone: function() {
        this._worldView.iconView.unselect_all();
    },

    _showAbout: function() {
        let artists = [ 'Jakub Steiner <jimmac@gmail.com>',
                        'Pink Sherbet Photography (D. Sharon Pruitt)',
                        'Elliott Brown',
                        'Analogick',
                        'DBduo Photography (Daniel R. Blume)',
                        'davharuk',
                        'Tech Haven Ministries',
                        'Jim Pennucci' ];
        let aboutDialog = new Gtk.AboutDialog(
            { artists: artists,
              authors: [ 'Giovanni Campagna <gcampagna@src.gnome.org>' ],
              translator_credits: _("translator-credits"),
              program_name: _("Weather"),
              comments: _("A weather application"),
              copyright: 'Copyright 2013 The Weather Developers',
              license_type: Gtk.License.GPL_2_0,
              logo_icon_name: 'org.gnome.Weather.Application',
              version: pkg.version,
              website: 'https://wiki.gnome.org/Apps/Weather',
              wrap_license: true,
              modal: true,
              transient_for: this,
              use_header_bar: true
            });

        aboutDialog.show();
        aboutDialog.connect('response', function() {
            aboutDialog.destroy();
        });
    },

    _deleteSelected: function() {
        let items = this._worldView.iconView.get_selection();
        let model = this._worldView.iconView.model;

        for (let i = items.length - 1; i >= 0; i--) {
            let [res, iter] = model.get_iter(items[i]);
            if (res)
                model.removeLocation(iter);
        }

        this._worldView.iconView.selection_mode = false;
    },

    _close: function() {
        this.destroy();
    }
});
