/**
Definition of the TemplateGenerator class.
@license MIT. Copyright (c) 2015 James Devlin / FluentDesk.
@module template-generator.js
*/

(function() {



  var FS = require( 'fs-extra' )
    , _ = require( 'underscore' )
    , MD = require( 'marked' )
    , XML = require( 'xml-escape' )
    , PATH = require('path')
    , MKDIRP = require('mkdirp')
    , BaseGenerator = require( './base-generator' )
    , EXTEND = require('../utils/extend')
    , Theme = require('../core/theme');



  // Default options.
  var _defaultOpts = {
    engine: 'underscore',
    keepBreaks: true,
    freezeBreaks: false,
    nSym: '&newl;', // newline entity
    rSym: '&retn;', // return entity
    template: {
      interpolate: /\{\{(.+?)\}\}/g,
      escape: /\{\{\=(.+?)\}\}/g,
      evaluate: /\{\%(.+?)\%\}/g,
      comment: /\{\#(.+?)\#\}/g
    },
    filters: {
      out: function( txt ) { return txt; },
      raw: function( txt ) { return txt; },
      xml: function( txt ) { return XML(txt); },
      md: function( txt ) { return MD( txt || '' ); },
      mdin: function( txt ) { return MD(txt || '' ).replace(/^\s*<p>|<\/p>\s*$/gi, ''); },
      lower: function( txt ) { return txt.toLowerCase(); },
      link: function( name, url ) { return url ?
        '<a href="' + url + '">' + name + '</a>' : name; }
    },
    prettify: { // ← See https://github.com/beautify-web/js-beautify#options
      indent_size: 2,
      unformatted: ['em','strong','a'],
      max_char: 80, // ← See lib/html.js in above-linked repo
      //wrap_line_length: 120, <-- Don't use this
    }
  };



  /**
  TemplateGenerator performs resume generation via local Handlebar or Underscore
  style template expansion and is appropriate for text-based formats like HTML,
  plain text, and XML versions of Microsoft Word, Excel, and OpenOffice.
  @class TemplateGenerator
  */
  var TemplateGenerator = module.exports = BaseGenerator.extend({



    init: function( outputFormat, templateFormat, cssFile ){
      this._super( outputFormat );
      this.tplFormat = templateFormat || outputFormat;
    },



    invoke: function( rez, themeMarkup, cssInfo, opts ) {
      this.opts = EXTEND( true, {}, _defaultOpts, opts );
      mk = this.single( rez, themeMarkup, this.format, cssInfo, { } );
      this.onBeforeSave && (mk = this.onBeforeSave( mk, themeFile, f ));
      return mk;
    },



    /**
    Default generation method for template-based generators.
    @method generate
    @param rez A FreshResume object.
    @param f Full path to the output resume file to generate.
    @param opts Generator options.
    */
    generate: function( rez, f, opts ) {

      // Carry over options
      this.opts = EXTEND( true, { }, _defaultOpts, opts );

      // Load the theme
      var themeInfo = themeFromMoniker.call( this );
      var theme = themeInfo.theme;
      var tFolder = themeInfo.folder;
      var tplFolder = PATH.join( tFolder, 'src' );
      var outFolder = PATH.parse(f).dir;
      var curFmt = theme.getFormat( this.format );
      var that = this;

      // "Generate": process individual files within the theme
      curFmt.files.forEach(function(tplInfo){
        if( tplInfo.action === 'transform' ) {
          transform.call( that, rez, f, tplInfo, theme, outFolder );
        }
        else if( tplInfo.action === null && theme.explicit ) {
          var thisFilePath = PATH.join(outFolder, tplInfo.orgPath);
          try {
            MKDIRP.sync( PATH.dirname(thisFilePath) );
            FS.copySync( tplInfo.path, thisFilePath );
          }
          catch(ex) {
            console.log(ex);
          }
        }
      });

      // Some themes require a symlink structure. If so, create it.
      if( curFmt.symLinks ) {
        Object.keys( curFmt.symLinks ).forEach( function(loc) {
          var absLoc = PATH.join(outFolder, loc);
          var absTarg = PATH.join(PATH.dirname(absLoc), curFmt.symLinks[loc]);
           // 'file', 'dir', or 'junction' (Windows only)
          var type = PATH.parse( absLoc ).ext ? 'file' : 'junction';
          FS.symlinkSync( absTarg, absLoc, type);
        });
      }

    },



    /**
    Perform a single resume JSON-to-DEST resume transformation.
    @param json A FRESH or JRS resume object.
    @param jst The stringified template data
    @param format The format name, such as "html" or "latex"
    @param cssInfo Needs to be refactored.
    @param opts Options and passthrough data.
    */
    single: function( json, jst, format, cssInfo, opts, theme ) {
      this.opts.freezeBreaks && ( jst = freeze(jst) );
      var eng = require( '../eng/' + ((opts.themeObj && opts.themeObj.engine) ||
        opts.engine)  + '-generator' );
      var result = eng( json, jst, format, cssInfo, opts, theme );
      this.opts.freezeBreaks && ( result = unfreeze(result) );
      return result;
    }


  });



  /**
  Export the TemplateGenerator function/ctor.
  */
  module.exports = TemplateGenerator;



  /**
  Given a theme title, load the corresponding theme.
  */
  function themeFromMoniker() {
    // Verify the specified theme name/path
    var tFolder = PATH.join(
      PATH.parse( require.resolve('fluent-themes') ).dir,
      this.opts.theme
    );
    var exists = require('../utils/file-exists');
    if( !exists( tFolder ) ) {
      tFolder = PATH.resolve( this.opts.theme );
      if( !exists( tFolder ) ) {
        throw { fluenterror: this.codes.themeNotFound, data: this.opts.theme};
      }
    }

    var t = this.opts.themeObj || new Theme().open( tFolder );

    // Load the theme and format
    return {
      theme: t,
      folder: tFolder
    };
  }



  /**
  Transform a single subfile.
  */
  function transform( rez, f, tplInfo, theme, outFolder ) {
    var cssInfo = { file: tplInfo.css ? tplInfo.cssPath : null, data: tplInfo.css || null };
    var mk = this.single( rez, tplInfo.data, this.format, cssInfo, this.opts, theme );
    this.onBeforeSave && (mk = this.onBeforeSave( { mk: mk, theme: theme, outputFile: f } ));
    var thisFilePath = PATH.join( outFolder, tplInfo.orgPath );
    try {
      MKDIRP.sync( PATH.dirname( tplInfo.major ? f : thisFilePath) );
      FS.writeFileSync( tplInfo.major ? f : thisFilePath, mk, { encoding: 'utf8', flags: 'w' } );
      this.onAfterSave && (mk = this.onAfterSave( { outputFile: (tplInfo.major ? f : thisFilePath), mk: mk } ));
    }
    catch(ex) {
      console.log(ex);
    }
  }



  /**
  Freeze newlines for protection against errant JST parsers.
  */
  function freeze( markup ) {
    return markup
      .replace( _reg.regN, _defaultOpts.nSym )
      .replace( _reg.regR, _defaultOpts.rSym );
  }



  /**
  Unfreeze newlines when the coast is clear.
  */
  function unfreeze( markup ) {
    return markup
      .replace( _reg.regSymR, '\r' )
      .replace( _reg.regSymN, '\n' );
  }



  /**
  Regexes for linebreak preservation.
  */
  var _reg = {
    regN: new RegExp( '\n', 'g' ),
    regR: new RegExp( '\r', 'g' ),
    regSymN: new RegExp( _defaultOpts.nSym, 'g' ),
    regSymR: new RegExp( _defaultOpts.rSym, 'g' )
  };



}());
