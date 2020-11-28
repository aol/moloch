from .MolochHost import viewer 
import base64

class MolochDecoder(object):

    def __init__(self):
        pass

    def decode(self, data, direction):
        raise NotImplementedError("decode")

class MolochDataFrame(object):
    def __init__(self, data = None):
        self._data = data

    def data(self):
        return self._data

    def frames(self):
        return None

    def htmlHeader(self):
        return self.__class__.__name__
    
    def htmlBody(self):
        html = ''
        frames = self.frames()
        if(frames is None):
            html += HtmlHelper.toHtml(self.data())
        else:
            for frame in frames:
                html += frame.html()
        return html

    def html(self):
        return self.htmlHeader() + '<br/>' + self.htmlBody()

class HtmlHelper(object):
    @staticmethod
    def toHtml(data):
        return viewer.toHtml(data)

    @staticmethod
    def toDownload(blob, title = 'download', filename = 'file'):
        return '''<a href="#" onclick="(function(el){
                debugger;
            if(el.href.endsWith('#'))
            {
                var blob = new Blob([atob('%s')], {type: 'octet/stream'});
                var url = window.URL.createObjectURL(blob);
                el.href = url;
                el.target = '_blank';
                el.download = '%s';
            }
        })(this)">%s</a>''' % (base64.b64encode(blob).decode('utf-8'), filename, title)
    
    @staticmethod
    def toImage(blob):
        return '''<img style="max-width:100%%" src="data:image/jpeg;base64, %s">''' % (base64.b64encode(blob).decode('utf-8'))