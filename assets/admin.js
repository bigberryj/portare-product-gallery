/* Product editor only; removal never deletes attachments. */
(function ($) {
  'use strict';
  $(function () {
    var $panel = $('#ppg_product_panel');
    if (!$panel.length) return;
    var $list = $panel.find('.ppg-admin-rows');
    var serial = 1000;
    function syncEditors() {
      if (window.tinymce) window.tinymce.triggerSave();
    }
    function startEditor(node) {
      if (window.wp && wp.editor && node.id) {
        wp.editor.initialize(node.id, {
          tinymce: { toolbar1: 'bold italic bullist numlist link unlink undo redo', toolbar2: '', wpautop: true },
          quicktags: true, mediaButtons: false
        });
      }
    }
    function removeEditors() {
      syncEditors();
      $list.find('.ppg-rich').each(function () {
        if (window.wp && wp.editor) wp.editor.remove(this.id);
      });
    }
    function refresh() {
      $list.children().each(function (index) {
        $(this).find('[name]').each(function () {
          this.name = this.name.replace(/ppg_slides\[[^\]]+\]/, 'ppg_slides[' + index + ']');
        });
        $(this).find('.ppg-up').prop('disabled', index === 0);
        $(this).find('.ppg-down').prop('disabled', index === $list.children().length - 1);
      });
    }
    $list.find('.ppg-rich').each(function () { startEditor(this); });
    refresh();
    $list.sortable({
      handle: '.ppg-drag',
      start: removeEditors,
      stop: function () {
        refresh();
        $list.find('.ppg-rich').each(function () { startEditor(this); });
      }
    });
    $panel.on('click', '.ppg-up, .ppg-down', function () {
      var $row = $(this).closest('.ppg-admin-row');
      removeEditors();
      if ($(this).hasClass('ppg-up')) $row.insertBefore($row.prev());
      else $row.insertAfter($row.next());
      refresh();
      $list.find('.ppg-rich').each(function () { startEditor(this); });
    });
    $panel.on('click', '.ppg-remove', function () {
      var $row = $(this).closest('.ppg-admin-row');
      var editor = $row.find('.ppg-rich')[0];
      if (window.wp && wp.editor) wp.editor.remove(editor.id);
      $row.remove(); refresh();
    });
    $panel.on('click', '.ppg-add-images', function () {
      var frame = wp.media({ title: 'Append gallery images', button: { text: 'Add images' }, library: { type: 'image' }, multiple: true });
      frame.on('select', function () {
        var used = {};
        $list.children().each(function () { used[$(this).find('.ppg-image-id').val()] = true; });
        frame.state().get('selection').each(function (model) {
          var image = model.toJSON();
          if (used[image.id] || (image.type && image.type !== 'image')) return;
          used[image.id] = true;
          var html = document.getElementById('ppg-row-template').innerHTML.replace(/__INDEX__/g, String(++serial));
          var $row = $(html);
          $row.attr('data-id', image.id).find('.ppg-image-id').val(image.id);
          $row.find('.ppg-image-label').text('Image #' + image.id);
          var url = image.sizes && image.sizes.thumbnail ? image.sizes.thumbnail.url : image.url;
          if (url && /^https?:\/\//i.test(url)) $('<img>', { src: url, alt: image.alt || '' }).appendTo($row.find('.ppg-preview'));
          $list.append($row);
          startEditor($row.find('.ppg-rich')[0]);
        });
        refresh();
      });
      frame.open();
    });
    $('#post').on('submit', syncEditors);
  });
})(jQuery);
