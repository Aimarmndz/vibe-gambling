// SPDX-License-Identifier: AGPL-3.0-or-later
// Zod 4 acelera los objetos compilando validadores con `new Function`, y para saber si puede lo
// prueba al crear cada `z.object`. Con nuestra CSP (sin 'unsafe-eval') esa prueba se bloquea y el
// navegador informa de una violación de CSP en cada página aunque zod se trague el error. Con
// `jitless` no se prueba ni se compila nada. Tiene que ser el PRIMER import de cada entrada: los
// esquemas de shared se crean al cargar el módulo.
import { z } from 'zod'

z.config({ jitless: true })
