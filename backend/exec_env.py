class ExecResult:
    def __init__(self, type:str, command: str, json_result: str, text_result: str, args=None):
        self.type = type
        self.command = command
        self.args = args
        self.json_result = json_result
        self.text_result = text_result

class ExecEnv:
    def __init__(self):
        self._results = []   # List to store results

    def add_result(self, result: ExecResult):
        self._results=[result]

    def get_text(self):
        if len(self._results) > 0:
            return self._results[0].text_result
        else:
            return ""

    def get_json(self):
        if len(self._results) > 0:
            return self._results[0].json_result
        else:
            return {}

    def get_results(self):
        if len(self._results) > 0:
            return self._results[0].json_result
        else:
            return []