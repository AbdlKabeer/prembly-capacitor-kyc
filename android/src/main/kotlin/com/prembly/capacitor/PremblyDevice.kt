package com.prembly.capacitor

import com.getcapacitor.Logger

class PremblyDevice {

    fun echo(value: String): String {
        Logger.info("Echo", value)

        return value
    }
}
