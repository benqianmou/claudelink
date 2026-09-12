package com.claudelink

class AnsiControlHandler {
    companion object {
        private const val ESC = '\u001B'
        private const val BEL = '\u0007'
    }
    
    fun process(raw: String): ProcessedData {
        var text = raw
        val commands = mutableListOf<ControlCommand>()

        val clearScreenStr = "$ESC[2J"
        if (text.contains(clearScreenStr)) {
            commands.add(ControlCommand.ClearScreen)
            text = text.replace(clearScreenStr, "")
        }
        
        val cursorHomeStr1 = "$ESC[H"
        val cursorHomeStr2 = "$ESC[1;1H"
        if (text.contains(cursorHomeStr1) || text.contains(cursorHomeStr2)) {
            commands.add(ControlCommand.CursorHome)
            text = text.replace(cursorHomeStr1, "").replace(cursorHomeStr2, "")
        }
        
        val patterns = arrayOf(
            """$ESC\[(K|0K)""",
            """$ESC\[2K""",
            """$ESC\[[0-9]*[ABCD]""",
            """$ESC\[[0-9;]*H""",
            """$ESC\[[0-9]*P""",
            """$ESC\[[0-9]*[LM]""",
            """$ESC\[[su]""",
            """$ESC\[\?100[0-3][hl]""",
            """$ESC\[\?1004[hl]""",
            """$ESC\[\?2004[hl]""",
            """$ESC\]0;[^$BEL]*($BEL|$ESC\)""",
            """$ESC\][0-9];[^$BEL]*$BEL""",
            """$ESC\[\?[0-9]+""",
            """$ESC\[[0-9;?]*[a-zA-Z]""",
            """$ESC[^\[]"""
        )
        
        patterns.forEach { pattern ->
            text = text.replace(pattern.toRegex(), "")
        }

        return ProcessedData(text, commands)
    }

    data class ProcessedData(
        val text: String,
        val commands: List<ControlCommand>
    )

    sealed class ControlCommand {
        object ClearScreen : ControlCommand()
        object CursorHome : ControlCommand()
    }
}
