require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const ALLOWED_ROLE_ID = "1471073279065329785";
const REJECT_CHANNEL_ID = "1478324986111463527";

const DATA_FILE = path.join(__dirname, 'tickets.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

// ================= LOAD JSON =================

let tickets = {};
if (fs.existsSync(DATA_FILE)) {
    try {
        tickets = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch {
        tickets = {};
    }
}

function saveTickets() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

// ================= REGISTER COMMANDS =================

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o => o.setName('client').setDescription('Client Name').setRequired(true))
            .addStringOption(o => o.setName('product').setDescription('Product').setRequired(true)
                .addChoices(
                    { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                    { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                ))
            .addStringOption(o => o.setName('status').setDescription('Status').setRequired(true))
            .addStringOption(o => o.setName('requests').setDescription('Requests').setRequired(true))
            .addStringOption(o => o.setName('representative_1').setDescription('Main Representative').setRequired(true))
            .addStringOption(o => o.setName('representative_2').setDescription('Second Representative').setRequired(false))
            .addStringOption(o => o.setName('ticket_id').setDescription('Custom ID').setRequired(false)),

        new SlashCommandBuilder()
            .setName('docorder')
            .setDescription('Upload order PDF')
            .addStringOption(o => o.setName('id').setDescription('Order ID').setRequired(true))
            .addAttachmentOption(o => o.setName('file').setDescription('PDF File').setRequired(true)),

        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Send order panel')
            .addStringOption(o => o.setName('id').setDescription('Order ID').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("✅ Bot Ready");
});

// ================= COMMAND HANDLER =================

client.on('interactionCreate', async interaction => {

    if (interaction.isChatInputCommand()) {

        // ================= ADD TICKET =================
        if (interaction.commandName === 'addticket') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "No permission", ephemeral: true });

            const customID = interaction.options.getString('ticket_id');
            const id = customID || generateID(interaction.options.getString('product'));

            tickets[id] = {
                id,
                client_name: interaction.options.getString('client'),
                product: interaction.options.getString('product'),
                status: interaction.options.getString('status'),
                requests: interaction.options.getString('requests'),
                representative_1: interaction.options.getString('representative_1'),
                representative_2: interaction.options.getString('representative_2') || null,
                last_updated: Date.now()
            };

            saveTickets();

            return interaction.reply({ content: `Ticket created: ${id}`, ephemeral: true });
        }

        // ================= DOC ORDER =================
        if (interaction.commandName === 'docorder') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "No permission", ephemeral: true });

            const id = interaction.options.getString('id');
            const file = interaction.options.getAttachment('file');

            if (!tickets[id])
                return interaction.reply({ content: "Order not found", ephemeral: true });

            const res = await fetch(file.url);
            const buffer = Buffer.from(await res.arrayBuffer());

            fs.writeFileSync(`${id}_doc.pdf`, buffer);

            return interaction.reply({ content: "PDF saved successfully.", ephemeral: true });
        }

        // ================= PANEL =================
        if (interaction.commandName === 'panel') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "No permission", ephemeral: true });

            const id = interaction.options.getString('id');
            const ticket = tickets[id];

            if (!ticket)
                return interaction.reply({ content: "Order not found", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`🌐 Status - ${ticket.representative_1}`)
                .addFields(
                    { name: "👨🏻‍✈️ Representatives:", value: ticket.representative_2 ? `${ticket.representative_1}\n${ticket.representative_2}` : ticket.representative_1 },
                    { name: "🗃️ Client:", value: ticket.client_name },
                    { name: "💳 Product:", value: ticket.product },
                    { name: "📊 Status:", value: ticket.status },
                    { name: "⏱️ Last Updated:", value: `<t:${Math.floor(ticket.last_updated / 1000)}:F>` }
                )
                .setFooter({ text: `VACompany | ${ticket.product.includes("Polaris") ? "Polaris™" : "Tracker™"}` })
                .setColor("Green");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${id}`)
                    .setLabel("Accept Order")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${id}`)
                    .setLabel("Reject Order")
                    .setStyle(ButtonStyle.Danger)
            );

            return interaction.reply({ embeds: [embed], components: [row] });
        }
    }

    // ================= BUTTON HANDLER =================
    if (interaction.isButton()) {

        const [action, id] = interaction.customId.split("_");
        const ticket = tickets[id];
        if (!ticket) return interaction.reply({ content: "Order not found", ephemeral: true });

        // Only reps allowed
        if (interaction.user.username !== ticket.representative_1 &&
            interaction.user.username !== ticket.representative_2) {
            return interaction.reply({ content: "You are not assigned to this order.", ephemeral: true });
        }

        // ACCEPT
        if (action === "accept") {

            const filePath = `${id}_doc.pdf`;
            if (!fs.existsSync(filePath))
                return interaction.reply({ content: "No PDF uploaded.", ephemeral: true });

            await interaction.user.send({
                content: "Here is your accepted order document:",
                files: [filePath]
            });

            return interaction.reply({ content: "Order accepted and sent to you.", ephemeral: true });
        }

        // REJECT
        if (action === "reject") {

            const channel = await client.channels.fetch(REJECT_CHANNEL_ID);

            const embed = new EmbedBuilder()
                .setTitle("Order Rejected")
                .addFields(
                    { name: "Client", value: ticket.client_name },
                    { name: "Order ID", value: id }
                )
                .setColor("Red");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rejectaccept_${id}`)
                    .setLabel("Accept")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`rejectdeny_${id}`)
                    .setLabel("Reject")
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });

            return interaction.reply({ content: "Rejection sent for review.", ephemeral: true });
        }

        // REJECT ACCEPT
        if (interaction.customId.startsWith("rejectaccept_")) {
            return interaction.reply({
                files: ["reject.pdf"]
            });
        }

        // REJECT DENY
        if (interaction.customId.startsWith("rejectdeny_")) {

            const modal = new ModalBuilder()
                .setCustomId(`rejectreason_${id}`)
                .setTitle("Rejection Reason");

            const input = new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Reason (min 25 letters)")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }
    }

    // ================= MODAL =================
    if (interaction.isModalSubmit()) {

        if (interaction.customId.startsWith("rejectreason_")) {

            const reason = interaction.fields.getTextInputValue("reason");

            if (reason.replace(/[^a-zA-Z]/g, "").length < 25)
                return interaction.reply({ content: "Minimum 25 letters required.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle("Rejection Message")
                .setDescription(reason)
                .setColor("Red");

            await interaction.user.send({ embeds: [embed] });

            return interaction.reply({ content: "Message sent.", ephemeral: true });
        }
    }
});

client.login(process.env.TOKEN);

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot running");
}).listen(process.env.PORT || 3000);
