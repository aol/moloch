import moloch
from .SampleTcpClassifier import SampleTcpClassifier

plugin = moloch.plugin([
    SampleTcpClassifier()
])