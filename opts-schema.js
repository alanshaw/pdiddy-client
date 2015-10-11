var Joi = require('joi')

var baseOptsSchema = Joi.object().keys({
  ddpVersion: Joi.string().valid('1').default('1')
})

module.exports = Joi.alternatives().try(
  baseOptsSchema.keys({
    key: Joi.string().required()
  }),
  baseOptsSchema.keys({
    host: Joi.string().hostname().required(),
    port: Joi.number().integer().default(80),
    path: Joi.string().default('/')
  })
)
